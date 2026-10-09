import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, getMeta, setMeta } from '../data/db'
import { QUOTE_META, loadFxRates, saveAsset, saveMovement, wipeLocalData } from '../data/repo'
import type { Asset } from '../domain/types'
import { createFinnhubProvider, guessCurrency, titleCase } from './finnhub'
import { fetchFxRates, fetchRateOn, missingRates } from './fx'
import { followSecurity, refreshQuotes, searchSecurities } from './service'

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

describe('búsqueda de valores', () => {
  beforeEach(wipeLocalData)

  const searchFetcher = async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.includes('/search')) {
      return json({
        count: 3,
        result: [
          { description: 'APPLE INC', symbol: 'AAPL', type: 'Common Stock' },
          { description: 'APPLE INC', symbol: 'AAPL', type: 'Common Stock' },
          { description: 'BANCO SANTANDER SA', symbol: 'SAN.MC', type: 'Common Stock' },
        ],
      })
    }
    return u.includes('SAN.MC') ? json({ error: 'sin acceso' }, 403) : json({ c: 190, pc: 188, t: 1_790_000_000 })
  }

  it('estima la divisa por el sufijo de bolsa', () => {
    expect(guessCurrency('AAPL')).toBe('USD')
    expect(guessCurrency('SAN.MC')).toBe('EUR')
    expect(guessCurrency('SAP.DE')).toBe('EUR')
    expect(guessCurrency('VOD.L')).toBe('GBP')
  })

  it('pasa los nombres de MAYÚSCULAS a título y respeta las siglas', () => {
    expect(titleCase('BANCO SANTANDER SA')).toBe('Banco Santander SA')
    expect(titleCase('APPLE HOSPITALITY REIT INC')).toBe('Apple Hospitality REIT Inc')
  })

  it('exige la clave de Finnhub', async () => {
    await expect(searchSecurities('apple', searchFetcher)).rejects.toThrow(/clave/)
  })

  it('devuelve resultados sin duplicados y con cotización cuando el plan la da', async () => {
    await setMeta(QUOTE_META.finnhubKey, 'K')
    const r = await searchSecurities('apple', searchFetcher)
    expect(r.map((x) => x.hit.symbol)).toEqual(['AAPL', 'SAN.MC'])
    expect(r[0].hit.name).toBe('Apple Inc')
    expect(r[0].quote?.price).toBe('190')
    expect(r[1].quote).toBeUndefined()
    expect(r[1].hit.currency).toBe('EUR')
  })

  it('seguir un valor crea el activo con su cotización', async () => {
    await setMeta(QUOTE_META.finnhubKey, 'K')
    const [apple] = await searchSecurities('apple', searchFetcher)
    const id = await followSecurity(apple)
    const a = await db.assets.get(id)
    expect(a).toMatchObject({ name: 'Apple Inc', ticker: 'AAPL', currency: 'USD', watched: true })
    expect((await db.quotes.get(id))?.price).toBe('190')
  })

  it('si el activo ya existe, lo reutiliza y no lo duplica', async () => {
    await setMeta(QUOTE_META.finnhubKey, 'K')
    const existing = await saveAsset({ name: 'Mi Apple', type: 'accion', currency: 'USD', ticker: 'AAPL' })
    const [apple] = await searchSecurities('apple', searchFetcher)
    const id = await followSecurity(apple)
    expect(id).toBe(existing)
    expect(await db.assets.count()).toBe(1)
    expect(await db.assets.get(id)).toMatchObject({ name: 'Mi Apple', watched: true })
  })
})

describe('cambio de un día (Frankfurter)', () => {
  it('pide el cambio de la fecha y devuelve la fecha real publicada', async () => {
    let url = ''
    const r = await fetchRateOn('USD', '2026-10-10', async (u) => {
      url = String(u)
      // un sábado: el BCE da el viernes
      return json({ date: '2026-10-09', rates: { USD: 1.1651 } })
    })
    expect(url).toContain('/2026-10-10?base=EUR&symbols=USD')
    expect(r).toEqual({ rate: '1.1651', date: '2026-10-09' })
  })

  it('falla con un mensaje claro si no hay cambio', async () => {
    await expect(fetchRateOn('XXX', '2026-10-09', async () => json({ date: '2026-10-09', rates: {} }))).rejects.toThrow(/no tiene cambio/)
  })
})

describe('missingRates', () => {
  it('pide USD siempre y las divisas de los activos y de sus precios manuales', () => {
    // Activo en EUR con un precio manual en dólares y otro en libras: faltan USD y GBP
    const assets = [
      { currency: 'EUR', manualPriceCurrency: 'USD' },
      { currency: 'GBP' },
      { currency: 'EUR' },
    ]
    expect(missingRates(assets, undefined)).toEqual(['GBP', 'USD'])
  })

  it('no pide las que ya tienen cambio ni el EUR', () => {
    expect(missingRates([{ currency: 'GBP' }], { rates: { USD: '1.17', GBP: '0.86' } })).toEqual([])
  })

  it('si no hay activos, solo falta USD', () => {
    expect(missingRates([], { rates: {} })).toEqual(['USD'])
  })
})
