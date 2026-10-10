import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, setMeta } from '../data/db'
import { QUOTE_META, saveAsset, saveMovement, wipeLocalData } from '../data/repo'
import type { Asset } from '../domain/types'
import { rangeForDays, refreshHistory, refreshQuotes, saveTodayPrices, searchSecurities } from './service'
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

  it('la prueba del proxy dice si funciona, con histórico', async () => {
    const f = async (url: RequestInfo | URL) =>
      String(url).includes('/history')
        ? json({ currency: 'EUR', days: [{ date: '2026-10-08', close: 4.5 }] })
        : json({ quotes: { 'SAN.MC': { price: 4.5, currency: 'EUR' } } })
    const ok = await testYahooProxy(PROXY, f)
    expect(ok).toEqual({ ok: true, message: expect.stringContaining('El histórico también') })
    expect((await testYahooProxy(PROXY, async () => json({}, 403))).ok).toBe(false)
    expect((await testYahooProxy('nada')).ok).toBe(false)
  })

  it('avisa si el proxy es una versión antigua sin histórico', async () => {
    const f = async (url: RequestInfo | URL) =>
      String(url).includes('/history') ? json({ error: 'Ruta no encontrada' }, 404) : json({ quotes: { 'SAN.MC': { price: 4.5, currency: 'EUR' } } })
    const r = await testYahooProxy(PROXY, f)
    expect(r).toMatchObject({ ok: true, outdated: true })
    expect(r.message).toMatch(/versión antigua/)
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
    if (u.includes('/history')) return json({ currency: 'EUR', days: [] })
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

  it('los proveedores van a la vez y, si los dos dan precio, gana Finnhub aunque Yahoo termine antes', async () => {
    const apple = await saveAsset({ name: 'Apple', type: 'accion', currency: 'USD', ticker: 'AAPL', watched: true })
    await setMeta(QUOTE_META.finnhubKey, 'K')
    await setMeta(QUOTE_META.yahooProxy, PROXY)
    let yahooDone = false
    const slowFinnhub = async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('finnhub.io')) {
        // Finnhub solo responde cuando Yahoo ya ha terminado: si fueran en serie, esto no acabaría nunca.
        while (!yahooDone) await new Promise((r) => setTimeout(r, 5))
        return json({ c: 190, pc: 188, t: 1_790_000_000 })
      }
      if (u.includes('/quote')) {
        yahooDone = true
        return json({ quotes: { AAPL: { price: 191, currency: 'USD', time: 1_790_000_100 } } })
      }
      return fetcher(url)
    }
    const report = await refreshQuotes(slowFinnhub)
    expect(report.updated).toBe(1)
    expect((await db.quotes.get(apple))?.provider).toBe('finnhub')
    expect(report.timings?.totalMs).toBeGreaterThanOrEqual(0)
    expect(report.timings?.yahooMs).toBeDefined()
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

describe('histórico de Yahoo', () => {
  beforeEach(wipeLocalData)

  const histFetcher = (calls: string[], days = [{ date: '2026-10-08', close: 72.5, high: 74, low: 70 }], currency = 'GBp') =>
    async (url: RequestInfo | URL) => {
      calls.push(String(url))
      return json({ symbol: 'VOD.L', currency, days })
    }

  it('convierte el histórico y pasa los peniques a libras', async () => {
    const p = createYahooProvider(PROXY, histFetcher([]))
    const days = await p.history!(asset('VOD.L'), '5y')
    expect(days).toEqual([{ assetId: 'VOD.L', date: '2026-10-08', price: '0.725', currency: 'GBP', high: '0.74', low: '0.7' }])
  })

  it('ignora días sin cierre y falla con un mensaje claro si el proxy no tiene la ruta', async () => {
    const p = createYahooProvider(PROXY, async () => json({ currency: 'EUR', days: [{ date: '2026-10-07', close: null }, { date: '2026-10-08', close: 4.5 }] }))
    expect((await p.history!(asset('SAN.MC'), '1mo')).map((d) => d.date)).toEqual(['2026-10-08'])
    const old = createYahooProvider(PROXY, async () => json({ error: 'Ruta no encontrada' }, 404))
    await expect(old.history!(asset('SAN.MC'), '1mo')).rejects.toThrow(/actualizado el código del Worker/)
  })

  it('elige el periodo más corto que cubre los días que faltan', () => {
    expect([10, 31, 60, 400, 1825, 2200, 9999].map(rangeForDays)).toEqual(['1mo', '1mo', '3mo', '2y', '5y', '10y', 'max'])
  })

  it('la primera vez baja 5 años, después solo lo que falta, y no insiste el mismo día', async () => {
    const id = await saveAsset({ name: 'Vodafone', type: 'accion', currency: 'GBP', ticker: 'VOD.L', watched: true })
    const a = (await db.assets.get(id))!
    const calls: string[] = []
    const provider = createYahooProvider(PROXY, histFetcher(calls))

    // 1.ª vez: sin datos guardados → 5 años
    await refreshHistory(provider, [a], [], '2026-10-09')
    expect(calls[0]).toContain('range=5y')
    expect(await db.quoteDays.count()).toBe(1)

    // el mismo día no vuelve a pedir
    await refreshHistory(provider, [a], [], '2026-10-09')
    expect(calls).toHaveLength(1)

    // Con 5 años ya guardados, 20 días después solo pide el último mes
    const old = Array.from({ length: 1300 }, (_, i) => ({
      assetId: id, date: new Date(Date.UTC(2021, 9, 10 + i)).toISOString().slice(0, 10), price: '1', currency: 'GBP',
    }))
    await db.quoteDays.clear()
    await setMeta(QUOTE_META.historyState, {}) // como una copia anterior, sin anotación: se deduce de lo guardado
    await db.quoteDays.bulkPut(old) // llega hasta 2025-04-30 aprox.
    const lastStored = old[old.length - 1].date
    await refreshHistory(provider, [a], [], '2026-10-10')
    expect(calls[1]).toContain(`range=${rangeForDays(Math.round((Date.parse('2026-10-10') - Date.parse(lastStored)) / 86_400_000) + 5)}`)
  })

  it('con una compra de hace más de 5 años, baja desde entonces', async () => {
    const id = await saveAsset({ name: 'Vodafone', type: 'accion', currency: 'GBP', ticker: 'VOD.L', watched: true })
    const m = await saveMovement({ assetId: id, type: 'compra', date: '2018-03-01', quantity: '1', price: '1', currency: 'GBP', fxRate: '1', fees: '0', withholding: '0' })
    const calls: string[] = []
    const movements = await db.movements.toArray()
    await refreshHistory(createYahooProvider(PROXY, histFetcher(calls)), [(await db.assets.get(id))!], movements, '2026-10-09')
    // 2018-03-01 → 2026-10-09 son unos 3.145 días: 10 años
    expect(calls[0]).toContain('range=10y')
    expect(m).toBeTruthy()
  })

  it('sin conexión reintenta enseguida; con un ticker que Yahoo no tiene, hasta mañana', async () => {
    const id = await saveAsset({ name: 'Vodafone', type: 'accion', currency: 'GBP', ticker: 'VOD.L', watched: true })
    const a = (await db.assets.get(id))!
    let n = 0
    const off = createYahooProvider(PROXY, async () => { n++; throw new TypeError('Failed to fetch') })
    await refreshHistory(off, [a], [], '2026-10-09')
    await refreshHistory(off, [a], [], '2026-10-09')
    expect(n).toBe(2)
    const bad = createYahooProvider(PROXY, async () => { n++; return json({ currency: 'EUR' }) })
    await refreshHistory(bad, [a], [], '2026-10-09')
    await refreshHistory(bad, [a], [], '2026-10-09')
    expect(n).toBe(3)
  })

  it('la actualización de precios baja el histórico con Yahoo y no se rompe si este falla', async () => {
    await saveAsset({ name: 'Santander', type: 'accion', currency: 'EUR', ticker: 'SAN.MC', watched: true })
    await setMeta(QUOTE_META.yahooProxy, PROXY)
    const ok = async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('frankfurter')) return json({ date: '2026-10-09', rates: { USD: 1.2 } })
      if (u.includes('/history')) return json({ currency: 'EUR', days: [{ date: '2026-10-08', close: 4.5, high: 4.6, low: 4.4 }] })
      return json({ quotes: { 'SAN.MC': { price: 4.52, currency: 'EUR', time: 1_790_000_000 } } })
    }
    const r = await refreshQuotes(ok)
    expect(r.historyDays).toBe(1)
    const noHistory = async (url: RequestInfo | URL) => (String(url).includes('/history') ? json({}, 404) : ok(url))
    await db.quoteDays.clear()
    await setMeta(QUOTE_META.historyTried, {})
    await setMeta(QUOTE_META.historyState, {})
    const r2 = await refreshQuotes(noHistory)
    expect(r2.updated).toBe(1)
    expect(r2.failed[0].message).toMatch(/^Histórico:/)
  })

  it('la descarga completa se hace una sola vez, aunque Yahoo devuelva menos de 5 años', async () => {
    const id = await saveAsset({ name: 'Joven', type: 'accion', currency: 'EUR', ticker: 'JOVEN.MC', watched: true })
    const a = (await db.assets.get(id))!
    const ranges: string[] = []
    const young = createYahooProvider(PROXY, async (url: RequestInfo | URL) => {
      ranges.push(new URL(String(url)).searchParams.get('range') ?? '')
      return json({ currency: 'EUR', days: [{ date: '2026-10-08', close: 4.5 }] })
    })
    await refreshHistory(young, [a], [], '2026-10-09')
    await refreshHistory(young, [a], [], '2026-10-10')
    await refreshHistory(young, [a], [], '2026-10-12')
    expect(ranges).toEqual(['5y'])
    // Tras varios días sin abrir la app, solo se pide un tramo corto.
    await refreshHistory(young, [a], [], '2026-10-20')
    expect(ranges).toEqual(['5y', '1mo'])
  })

  it('el precio de cada actualización completa el histórico sin pedir nada, salvo fines de semana', async () => {
    const id = await saveAsset({ name: 'Santander', type: 'accion', currency: 'EUR', ticker: 'SAN.MC', watched: true })
    await db.quoteDays.put({ assetId: id, date: '2026-10-08', price: '4.40', currency: 'EUR', high: '4.60', low: '4.30' })
    const q = (at: string, price: string) => ({ assetId: id, price, currency: 'EUR', at, provider: 'yahoo' })
    // 8 oct (jueves, con máximo y mínimo ya guardados), 10 oct (sábado)
    await saveTodayPrices([q('2026-10-08T10:00:00', '4.52'), q('2026-10-10T10:00:00', '4.55')])
    const days = await db.quoteDays.where('assetId').equals(id).toArray()
    expect(days.map((d) => [d.date, d.price, d.high])).toEqual([['2026-10-08', '4.52', '4.60']])
  })
})
