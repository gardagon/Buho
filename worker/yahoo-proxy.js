/**
 * Proxy de cotizaciones de Yahoo Finance para Buho.
 *
 * Se despliega UNA vez en Cloudflare Workers (plan gratuito, sin tarjeta) y la app
 * lo llama desde el navegador. Hace de puente porque Yahoo no permite llamadas
 * directas desde una web (CORS) y su API no es oficial: si Yahoo cambia algo, se
 * arregla aquí, sin tocar la app. Pasos en docs/YAHOO.md.
 *
 * Solo ve los símbolos que se consultan (por ejemplo SAN.MC). Nunca recibe
 * movimientos, cantidades ni datos de la cartera.
 *
 *   GET /quote?symbols=SAN.MC,AAPL
 *     → { quotes: { "SAN.MC": { price, previousClose, currency, time, name } },
 *         errors: { "XXX": "mensaje" } }
 *   GET /search?q=santander
 *     → { results: [ { symbol, name, type, exchange } ] }
 *   GET /history?symbol=SAN.MC&range=5y
 *     → { symbol, currency, days: [ { date, close, high, low } ] }   (un día por fila, de antiguo a reciente)
 */

// Webs que pueden usar el proxy. Añade aquí la tuya si alojas tu propia copia de Buho.
const ALLOWED_ORIGINS = ['https://gardagon.github.io', 'http://localhost:5173', 'http://localhost:4173']

const YAHOO = 'https://query1.finance.yahoo.com'
const MAX_SYMBOLS = 25
const RANGES = ['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']
const SYMBOL = /^[A-Za-z0-9.^=\-]{1,24}$/
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; Buho/1.0)', Accept: 'application/json' }

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) },
  })

/** Pide a Yahoo con una caché en el borde de Cloudflare (60 s por defecto), para no abusar de su servicio. */
async function yahooJson(url, ctx, ttl = 60) {
  const cache = caches.default
  const key = new Request(url)
  const hit = await cache.match(key)
  if (hit) return hit.json()
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Yahoo respondió con el error ${res.status}`)
  const copy = new Response(res.clone().body, { headers: { 'Cache-Control': `public, max-age=${ttl}` } })
  ctx.waitUntil(cache.put(key, copy))
  return res.json()
}

async function quote(symbol, ctx) {
  const data = await yahooJson(`${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, ctx)
  const meta = data?.chart?.result?.[0]?.meta
  if (!meta || typeof meta.regularMarketPrice !== 'number') {
    throw new Error(data?.chart?.error?.description ?? 'Sin datos')
  }
  return {
    price: meta.regularMarketPrice,
    // Con range=1d, chartPreviousClose es el cierre del día anterior.
    previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    currency: meta.currency ?? null,
    time: meta.regularMarketTime ?? null,
    name: meta.shortName ?? meta.longName ?? null,
  }
}

/** Cierre, máximo y mínimo de cada día. La fecha es la del mercado del valor, no la de Cloudflare. */
async function history(symbol, range, ctx) {
  const data = await yahooJson(`${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, ctx, 3600)
  const result = data?.chart?.result?.[0]
  const q = result?.indicators?.quote?.[0]
  if (!result || !q || !Array.isArray(result.timestamp)) {
    throw new Error(data?.chart?.error?.description ?? 'Sin datos')
  }
  const offset = result.meta?.gmtoffset ?? 0
  const days = []
  result.timestamp.forEach((t, i) => {
    const close = q.close?.[i]
    if (typeof close !== 'number') return // días sin cotización (festivos con hueco)
    days.push({
      date: new Date((t + offset) * 1000).toISOString().slice(0, 10),
      close,
      high: typeof q.high?.[i] === 'number' ? q.high[i] : null,
      low: typeof q.low?.[i] === 'number' ? q.low[i] : null,
    })
  })
  return { symbol, currency: result.meta?.currency ?? null, days }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') ?? ''
    const allowed = ALLOWED_ORIGINS.includes(origin)
    if (request.method === 'OPTIONS') {
      return allowed ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 })
    }
    if (request.method !== 'GET') return json({ error: 'Método no permitido' }, 405, origin)
    // Las llamadas desde un navegador siempre traen Origin; solo se aceptan las de las webs de la lista.
    if (!allowed) return json({ error: 'Origen no permitido' }, 403, ALLOWED_ORIGINS[0])

    const url = new URL(request.url)
    try {
      if (url.pathname === '/quote') {
        const symbols = [...new Set((url.searchParams.get('symbols') ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
        if (symbols.length === 0 || symbols.length > MAX_SYMBOLS || !symbols.every((s) => SYMBOL.test(s))) {
          return json({ error: `Pide entre 1 y ${MAX_SYMBOLS} símbolos válidos` }, 400, origin)
        }
        const quotes = {}
        const errors = {}
        await Promise.all(
          symbols.map(async (s) => {
            try {
              quotes[s] = await quote(s, ctx)
            } catch (e) {
              errors[s] = e instanceof Error ? e.message : 'Error'
            }
          }),
        )
        return json({ quotes, errors }, 200, origin)
      }

      if (url.pathname === '/history') {
        const symbol = (url.searchParams.get('symbol') ?? '').trim()
        const range = url.searchParams.get('range') ?? '5y'
        if (!SYMBOL.test(symbol) || !RANGES.includes(range)) {
          return json({ error: `Pide un símbolo válido y un periodo entre ${RANGES.join(', ')}` }, 400, origin)
        }
        return json(await history(symbol, range, ctx), 200, origin)
      }

      if (url.pathname === '/search') {
        const q = (url.searchParams.get('q') ?? '').trim().slice(0, 60)
        if (q.length < 2) return json({ results: [] }, 200, origin)
        const data = await yahooJson(
          `${YAHOO}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&lang=es-ES&region=ES`,
          ctx,
        )
        const results = (data?.quotes ?? [])
          .filter((r) => r.symbol && r.isYahooFinance !== false)
          .map((r) => ({
            symbol: r.symbol,
            name: r.longname ?? r.shortname ?? r.symbol,
            type: r.quoteType ?? null,
            exchange: r.exchDisp ?? r.exchange ?? null,
          }))
        return json({ results }, 200, origin)
      }

      return json({ error: 'Ruta no encontrada. Usa /quote, /search o /history' }, 404, origin)
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'Error' }, 502, origin)
    }
  },
}
