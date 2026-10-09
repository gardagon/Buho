import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './yahoo-proxy.js'

const ORIGIN = 'https://gardagon.github.io'
const ctx = { waitUntil: () => {} }
const get = (path, origin = ORIGIN) =>
  worker.fetch(new Request('https://proxy.test' + path, { headers: origin ? { Origin: origin } : {} }), {}, ctx)

// Respuestas con la forma que devuelve Yahoo
const chart = (price, prev, currency) => ({
  chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev, currency, regularMarketTime: 1790000000, shortName: 'X' } }], error: null },
})

beforeEach(() => {
  // La caché de Cloudflare no existe en Node: se simula vacía.
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('/v8/finance/chart/SAN.MC')) return new Response(JSON.stringify(chart(4.52, 4.4, 'EUR')))
    if (u.includes('/v8/finance/chart/')) return new Response(JSON.stringify({ chart: { result: null, error: { description: 'No data found' } } }))
    if (u.includes('/v1/finance/search')) {
      return new Response(JSON.stringify({ quotes: [{ symbol: 'SAN.MC', longname: 'Banco Santander, S.A.', quoteType: 'EQUITY', exchDisp: 'Madrid' }] }))
    }
    return new Response('{}', { status: 404 })
  })
})

describe('proxy de Yahoo (Worker)', () => {
  it('devuelve las cotizaciones en el formato de Buho, con CORS solo para su web', async () => {
    const r = await get('/quote?symbols=SAN.MC,NOEXISTE')
    expect(r.status).toBe(200)
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    const body = await r.json()
    expect(body.quotes['SAN.MC']).toMatchObject({ price: 4.52, previousClose: 4.4, currency: 'EUR' })
    expect(body.errors.NOEXISTE).toBe('No data found')
  })

  it('traduce la búsqueda', async () => {
    const body = await (await get('/search?q=santander')).json()
    expect(body.results).toEqual([{ symbol: 'SAN.MC', name: 'Banco Santander, S.A.', type: 'EQUITY', exchange: 'Madrid' }])
  })

  it('rechaza webs que no son la de Buho', async () => {
    expect((await get('/quote?symbols=SAN.MC', 'https://otra.web')).status).toBe(403)
    expect((await get('/quote?symbols=SAN.MC', '')).status).toBe(403)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('valida los símbolos antes de llamar a Yahoo', async () => {
    expect((await get('/quote?symbols=')).status).toBe(400)
    expect((await get('/quote?symbols=../../etc')).status).toBe(400)
    expect((await get('/quote?symbols=' + Array.from({ length: 26 }, (_, i) => 'A' + i).join(','))).status).toBe(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('responde a la comprobación previa (OPTIONS) de los navegadores', async () => {
    const r = await worker.fetch(new Request('https://proxy.test/quote', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), {}, ctx)
    expect(r.status).toBe(204)
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('GET')
  })
})
