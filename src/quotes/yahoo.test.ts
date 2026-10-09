import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, setMeta } from '../data/db'
import { QUOTE_META, saveAsset, wipeLocalData } from '../data/repo'
import type { Asset } from '../domain/types'
import { refreshQuotes, searchSecurities } from './service'
import { createYahooProvider, mapYahooType, normalizeCurrency, normalizeProxyUrl, testYahooProxy } from './yahoo'

const PROXY = 'https://buho-yahoo.ejemplo.workers.dev'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const asset = (ticker: string | undefined, id = ticker ?? 'sin'): Asset => ({
  id, name: id, type: 'accion', currency: 'EUR', ticker, createdAt: '', updatedAt: '',
})

describe('proxy de Yahoo', () => {
  it('convierte la respuesta del proxy en cotizaciones con su divisa real', async () => {
    const p = createYahooProvider(PROXY, async (url) => {
      expect(String(url)).toBe(`${PROXY}/quote?symbols=SAN.MC%2CAAPL`)
      return json({
        quotes: {
          'SAN.MC': { price: 4.52, previousClose: 4.4, currency: 'EUR', time: 1_790_000_000 },
          AAPL: { price: 190, previousClose: 188, currency: 'USD', time: 1_790_000_000 },
        },
      })
    })
    const r = await p.getQuotes([asset('SAN.MC'), asset('AAPL')])
    expect(r.quotes.get('SAN.MC')).toMatchObject({ price: '4.52', prevClose: '4.4', currency: 'EUR', provider: 'yahoo' })
    expect(r.quotes.get('AAPL')?.currency).toBe('USD')
    expect(r.quotes.get('SAN.MC')?.at).toBe(new Date(1_790_000_000 * 1000).toISOString())
  })

  it('pasa los peniques de Londres a libras: 72,5 GBp = 0,725 £', async () => {
    const p = createYahooProvider(PROXY, async () =>
      json({ quotes: { 'VOD.L': { price: 72.5, previousClose: 70, currency: 'GBp', time: 1_790_000_000 } } }),
    )
    const q = (await p.getQuotes([asset('VOD.L')])).quotes.get('VOD.L')!
    expect([q.price, q.prevClose, q.currency]).toEqual(['0.725', '0.7', 'GBP'])
    expect(normalizeCurrency('ZAc')).toEqual({ currency: 'ZAR', divisor: 100 })
  })

  it('un símbolo que Yahoo no conoce es un error claro, no un precio cero', async () => {
    const p = createYahooProvider(PROXY, async () => json({ quotes: {}, errors: { XXX: 'Sin datos' } }))
    const r = await p.getQuotes([asset('XXX')])
    expect(r.quotes.size).toBe(0)
    expect(r.errors.get('XXX')).toMatch(/Yahoo no tiene datos de XXX/)
  })

  it('explica el límite de llamadas y la falta de conexión', async () => {
    const limit = await createYahooProvider(PROXY, async () => json({}, 429)).getQuotes([asset('A')])
    expect(limit.errors.get('A')).toMatch(/limita/)
    const off = await createYahooProvider(PROXY, async () => {
      throw new TypeError('Failed to fetch')
    }).getQuotes([asset('A')])
    expect(off.errors.get('A')).toMatch(/Sin conexión/)
  })

  it('busca valores y traduce el tipo y la bolsa', async () => {
    const p = createYahooProvider(PROXY, async (url) => {
      expect(String(url)).toBe(`${PROXY}/search?q=santander`)
      return json({
        results: [
          { symbol: 'SAN.MC', name: 'Banco Santander, S.A.', type: 'EQUITY', exchange: 'Madrid' },
          { symbol: 'SAN.MC', name: 'duplicado', type: 'EQUITY', exchange: 'Madrid' },
          { symbol: 'VWCE.DE', name: 'Vanguard FTSE All-World', type: 'ETF', exchange: 'XETRA' },
        ],
      })
    })
    const hits = await p.search!('santander')
    expect(hits.map((h) => [h.symbol, h.type, h.exchange, h.currency])).toEqual([
      ['SAN.MC', 'accion', 'Madrid', 'EUR'],
      ['VWCE.DE', 'etf', 'XETRA', 'EUR'],
    ])
    expect(mapYahooType('MUTUALFUND')).toBe('fondo')
    expect(mapYahooType(undefined)).toBe('otro')
  })

  it('valida la dirección del proxy', () => {
    expect(normalizeProxyUrl(' https://a.b.workers.dev/ ')).toBe('https://a.b.workers.dev')
    expect(normalizeProxyUrl('http://localhost:8787')).toBe('http://localhost:8787')
    expect(normalizeProxyUrl('http://a.b.dev')).toBeNull()
    expect(normalizeProxyUrl('a.b.dev')).toBeNull()
  })

  it('la prueba del proxy dice si funciona', async () => {
    const ok = await testYahooProxy(PROXY, async () => json({ quotes: { 'SAN.MC': { price: 4.5, currency: 'EUR' } } }))
    expect(ok).toEqual({ ok: true, message: expect.stringContaining('4.5 EUR') })
    const bad = await testYahooProxy(PROXY, async () => json({}, 403))
    expect(bad.ok).toBe(false)
    expect((await testYahooProxy('nada')).ok).toBe(false)
  })
})

describe('Finnhub con Yahoo de respaldo', () => {
  beforeEach(wipeLocalData)

  const fetcher = async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.includes('frankfurter')) return json({ date: '2026-10-09', rates: { USD: 1.2 } })
    if (u.includes('finnhub.io/api/v1/quote')) {
      // El plan gratuito solo da EE. UU.
      return u.includes('symbol=AAPL') ? json({ c: 190, pc: 188, t: 1_790_000_000 }) : json({ error: 'sin acceso' }, 403)
    }
    if (u.includes('finnhub.io/api/v1/search')) return json({ result: [] })
    if (u.startsWith(PROXY + '/quote')) {
      return json({ quotes: { 'SAN.MC': { price: 4.52, previousClose: 4.4, currency: 'EUR', time: 1_790_000_000 } } })
    }
    throw new Error('URL inesperada ' + u)
  }

  it('lo que Finnhub no cubre lo cotiza Yahoo', async () => {
    const apple = await saveAsset({ name: 'Apple', type: 'accion', currency: 'USD', ticker: 'AAPL', watched: true })
    const san = await saveAsset({ name: 'Santander', type: 'accion', currency: 'EUR', ticker: 'SAN.MC', watched: true })
    await setMeta(QUOTE_META.finnhubKey, 'K')
    await setMeta(QUOTE_META.yahooProxy, PROXY)

    const report = await refreshQuotes(fetcher)

    expect(report.updated).toBe(2)
    expect(report.failed).toEqual([])
    expect((await db.quotes.get(apple))?.provider).toBe('finnhub')
    expect((await db.quotes.get(san))?.provider).toBe('yahoo')
  })

  it('sin Finnhub, Yahoo cotiza todo', async () => {
    await saveAsset({ name: 'Santander', type: 'accion', currency: 'EUR', ticker: 'SAN.MC', watched: true })
    await setMeta(QUOTE_META.yahooProxy, PROXY)
    expect((await refreshQuotes(fetcher)).updated).toBe(1)
  })

  it('sin Yahoo, el fallo de Finnhub se queda como aviso', async () => {
    await saveAsset({ name: 'Santander', type: 'accion', currency: 'EUR', ticker: 'SAN.MC', watched: true })
    await setMeta(QUOTE_META.finnhubKey, 'K')
    const report = await refreshQuotes(fetcher)
    expect(report.updated).toBe(0)
    expect(report.failed[0].message).toMatch(/plan/)
  })

  it('la búsqueda usa Yahoo si está configurado y toma la divisa real de la cotización', async () => {
    await setMeta(QUOTE_META.yahooProxy, PROXY)
    const f = async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('/search')) return json({ results: [{ symbol: 'VOD.L', name: 'Vodafone', type: 'EQUITY', exchange: 'LSE' }] })
      return json({ quotes: { 'VOD.L': { price: 72.5, currency: 'GBp', time: 1_790_000_000 } } })
    }
    const [r] = await searchSecurities('vodafone', f)
    expect(r.hit.currency).toBe('GBP')
    expect(r.quote?.price).toBe('0.725')
  })
})
