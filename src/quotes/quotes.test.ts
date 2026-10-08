import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, getMeta, setMeta } from '../data/db'
import { QUOTE_META, loadFxRates, saveAsset, saveMovement, wipeLocalData } from '../data/repo'
import type { Asset } from '../domain/types'
import { createFinnhubProvider } from './finnhub'
import { fetchFxRates } from './fx'
import { refreshQuotes } from './service'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const asset = (ticker?: string, extra: Partial<Asset> = {}): Asset => ({
  id: ticker ?? 'sin-ticker',
  name: ticker ?? 'Sin ticker',
  type: 'accion',
  currency: 'USD',
  ticker,
  createdAt: '',
  updatedAt: '',
  ...extra,
})

describe('Finnhub', () => {
  it('convierte la respuesta en una cotización', async () => {
    const p = createFinnhubProvider('K', async (url) => {
      expect(String(url)).toContain('symbol=AAPL')
      expect(String(url)).toContain('token=K')
      return json({ c: 189.84, pc: 188.5, t: 1_790_000_000 })
    })
    const r = await p.getQuotes([asset('AAPL')])
    const q = r.quotes.get('AAPL')!
    expect(q.price).toBe('189.84')
    expect(q.prevClose).toBe('188.5')
    expect(q.currency).toBe('USD')
    expect(q.at).toBe(new Date(1_790_000_000 * 1000).toISOString())
  })

  it('un símbolo sin datos (todo a cero) es un error, no un precio cero', async () => {
    const p = createFinnhubProvider('K', async () => json({ c: 0, pc: 0, t: 0 }))
    const r = await p.getQuotes([asset('SAN.MC')])
    expect(r.quotes.size).toBe(0)
    expect(r.errors.get('SAN.MC')).toMatch(/no tiene datos/)
  })

  it('explica el 403 del plan gratuito y sigue con el resto', async () => {
    const p = createFinnhubProvider('K', async (url) =>
      String(url).includes('SAP.DE') ? json({ error: 'no access' }, 403) : json({ c: 10, t: 1_790_000_000 }),
    )
    const r = await p.getQuotes([asset('SAP.DE'), asset('MSFT')])
    expect(r.errors.get('SAP.DE')).toMatch(/plan/)
    expect(r.quotes.has('MSFT')).toBe(true)
  })

  it('solo admite activos con ticker y que no sean fondos ni bonos', () => {
    const p = createFinnhubProvider('K')
    expect(p.supports(asset('AAPL'))).toBe(true)
    expect(p.supports(asset(undefined))).toBe(false)
    expect(p.supports(asset('X', { type: 'fondo' }))).toBe(false)
  })
})

describe('tipos de cambio (Frankfurter)', () => {
  it('pide solo las divisas distintas de EUR y las guarda como texto', async () => {
    let url = ''
    const fx = await fetchFxRates(['USD', 'EUR', 'USD', 'GBP'], async (u) => {
      url = String(u)
      return json({ date: '2026-10-08', rates: { USD: 1.1654, GBP: 0.8712 } })
    })
    expect(url).toContain('symbols=USD,GBP')
    expect(fx).toEqual({ date: '2026-10-08', rates: { USD: '1.1654', GBP: '0.8712' } })
  })

  it('no llama a la red si todo está en EUR', async () => {
    const fx = await fetchFxRates(['EUR'], async () => {
      throw new Error('no debería llamarse')
    })
    expect(fx.rates).toEqual({})
  })
})

describe('refreshQuotes', () => {
  beforeEach(wipeLocalData)

  const base = { currency: 'USD', fxRate: '1.2', fees: '0', withholding: '0' }
  const fetcher = async (url: RequestInfo | URL) =>
    String(url).includes('frankfurter')
      ? json({ date: '2026-10-08', rates: { USD: 1.2 } })
      : json({ c: 120, pc: 118, t: 1_790_000_000 })

  it('guarda cotizaciones de lo que está en cartera o en seguimiento', async () => {
    const held = await saveAsset({ name: 'Apple', type: 'accion', currency: 'USD', ticker: 'AAPL' })
    const watched = await saveAsset({ name: 'Microsoft', type: 'accion', currency: 'USD', ticker: 'MSFT', watched: true })
    await saveAsset({ name: 'Ignorado', type: 'accion', currency: 'USD', ticker: 'IGN' })
    await saveMovement({ ...base, assetId: held, type: 'compra', date: '2026-01-10', quantity: '1', price: '100' })
    await setMeta(QUOTE_META.finnhubKey, 'K')

    const report = await refreshQuotes(fetcher)

    expect(report.updated).toBe(2)
    expect((await db.quotes.toArray()).map((q) => q.assetId).sort()).toEqual([held, watched].sort())
    expect((await loadFxRates())?.rates.USD).toBe('1.2')
    expect(await getMeta(QUOTE_META.refreshedAt)).toBeTruthy()
  })

  it('sin clave solo actualiza los tipos de cambio', async () => {
    const a = await saveAsset({ name: 'Apple', type: 'accion', currency: 'USD', ticker: 'AAPL', watched: true })
    const report = await refreshQuotes(fetcher)
    expect(report.usedProvider).toBe(false)
    expect(await db.quotes.count()).toBe(0)
    expect((await loadFxRates())?.rates.USD).toBe('1.2')
    expect(a).toBeTruthy()
  })

  it('si falla el cambio, informa y conserva el anterior', async () => {
    await saveAsset({ name: 'Apple', type: 'accion', currency: 'USD', ticker: 'AAPL', watched: true })
    await refreshQuotes(fetcher)
    const report = await refreshQuotes(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(report.fxError).toMatch(/Sin conexión/)
    expect((await loadFxRates())?.rates.USD).toBe('1.2')
  })
})
