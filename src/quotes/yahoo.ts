import { Decimal } from '../domain/numbers'
import type { Asset, AssetType, Quote, QuoteDay } from '../domain/types'
import { guessCurrency } from './finnhub'
import type { Fetcher, HistoryRange, PriceProvider, QuoteResult, SearchHit } from './types'

/**
 * Yahoo Finance a través del proxy propio de `worker/yahoo-proxy.js` (Cloudflare
 * Workers, gratuito). La app no habla con Yahoo directamente: Yahoo no permite
 * llamadas desde una web y su API no es oficial. El proxy da un formato estable
 * y propio; si Yahoo cambia algo, se arregla en el Worker.
 *
 * Cubre BME, Xetra, Euronext, Londres… con el ticker de Yahoo (`SAN.MC`, `SAP.DE`)
 * y da la divisa real de cada valor.
 */

const CHUNK = 20

interface ProxyQuote {
  price?: number | null
  previousClose?: number | null
  currency?: string | null
  time?: number | null
}

interface ProxyResult {
  symbol?: string
  name?: string | null
  type?: string | null
  exchange?: string | null
}

/** Yahoo da Londres en peniques (GBp) y Johannesburgo en céntimos (ZAc): se pasan a libras y rands. */
export function normalizeCurrency(currency: string): { currency: string; divisor: number } {
  if (currency === 'GBp' || currency === 'GBX') return { currency: 'GBP', divisor: 100 }
  if (currency === 'ZAc') return { currency: 'ZAR', divisor: 100 }
  return { currency: currency.toUpperCase(), divisor: 1 }
}

export function mapYahooType(type: string | null | undefined): AssetType {
  switch ((type ?? '').toUpperCase()) {
    case 'ETF':
      return 'etf'
    case 'MUTUALFUND':
      return 'fondo'
    case 'CRYPTOCURRENCY':
      return 'cripto'
    case 'FUTURE':
      return 'materia_prima'
    case 'EQUITY':
      return 'accion'
    default:
      return 'otro'
  }
}

/** Quita espacios y la barra final; solo admite https (y http en localhost, para probar). */
export function normalizeProxyUrl(raw: string): string | null {
  const url = raw.trim().replace(/\/+$/, '')
  return /^https:\/\/[^\s/]+/.test(url) || /^http:\/\/localhost(:\d+)?/.test(url) ? url : null
}

const isOffline = (e: unknown) => e instanceof TypeError || (e instanceof Error && e.message === 'Failed to fetch')

export function createYahooProvider(proxyUrl: string, fetcher: Fetcher = (...a) => fetch(...a)): PriceProvider {
  const base = proxyUrl.replace(/\/+$/, '')

  return {
    id: 'yahoo',
    name: 'Yahoo Finance',
    supports: (a) => !!a.ticker,

    async getQuotes(assets: Asset[]): Promise<QuoteResult> {
      const out: QuoteResult = { quotes: new Map(), errors: new Map() }
      const bySymbol = new Map<string, Asset[]>()
      for (const a of assets) bySymbol.set(a.ticker!.toUpperCase(), [...(bySymbol.get(a.ticker!.toUpperCase()) ?? []), a])
      const symbols = [...bySymbol.keys()]

      for (let i = 0; i < symbols.length; i += CHUNK) {
        const chunk = symbols.slice(i, i + CHUNK)
        const fail = (message: string) => {
          for (const s of chunk) for (const a of bySymbol.get(s)!) out.errors.set(a.id, message)
        }
        try {
          const res = await fetcher(`${base}/quote?symbols=${encodeURIComponent(chunk.join(','))}`)
          if (!res.ok) {
            fail(res.status === 429 ? 'Yahoo limita las llamadas. Espera un poco y vuelve a actualizar.' : `El proxy de Yahoo respondió con el error ${res.status}.`)
            continue
          }
          const data = (await res.json()) as { quotes?: Record<string, ProxyQuote>; errors?: Record<string, string> }
          for (const s of chunk) {
            const q = data.quotes?.[s]
            for (const a of bySymbol.get(s)!) {
              if (!q?.price || q.price <= 0 || !q.currency) {
                out.errors.set(a.id, `Yahoo no tiene datos de ${s}. Revisa el ticker (p. ej. SAN.MC para Madrid) o usa un precio manual.`)
                continue
              }
              const { currency, divisor } = normalizeCurrency(q.currency)
              const scale = (n: number) => new Decimal(n).div(divisor).toString()
              const quote: Quote = {
                assetId: a.id,
                price: scale(q.price),
                currency,
                at: q.time ? new Date(q.time * 1000).toISOString() : new Date().toISOString(),
                prevClose: q.previousClose && q.previousClose > 0 ? scale(q.previousClose) : undefined,
                provider: 'yahoo',
              }
              out.quotes.set(a.id, quote)
            }
          }
        } catch (e) {
          fail(isOffline(e) ? 'Sin conexión con el proxy de Yahoo.' : 'La respuesta del proxy de Yahoo no es válida.')
        }
      }
      return out
    },

    async history(asset: Asset, range: HistoryRange): Promise<QuoteDay[]> {
      const symbol = asset.ticker!.toUpperCase()
      let res: Response
      try {
        res = await fetcher(`${base}/history?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      } catch (e) {
        throw new Error(isOffline(e) ? 'Sin conexión con el proxy de Yahoo.' : 'No se pudo pedir el histórico.')
      }
      if (!res.ok) {
        throw new Error(res.status === 429 ? 'Yahoo limita las llamadas. Espera un poco.' : `El proxy de Yahoo respondió con el error ${res.status}. ¿Has actualizado el código del Worker?`)
      }
      const data = (await res.json()) as {
        currency?: string | null
        days?: { date?: string; close?: number | null; high?: number | null; low?: number | null }[]
      }
      if (!data.currency || !Array.isArray(data.days)) throw new Error(`Yahoo no tiene histórico de ${symbol}.`)
      const { currency, divisor } = normalizeCurrency(data.currency)
      const scale = (n: number) => new Decimal(n).div(divisor).toString()
      const out: QuoteDay[] = []
      for (const d of data.days) {
        if (!d.date || !d.close || d.close <= 0) continue
        out.push({
          assetId: asset.id,
          date: d.date,
          price: scale(d.close),
          currency,
          high: d.high && d.high > 0 ? scale(d.high) : undefined,
          low: d.low && d.low > 0 ? scale(d.low) : undefined,
        })
      }
      return out
    },

    async search(query): Promise<SearchHit[]> {
      const res = await fetcher(`${base}/search?q=${encodeURIComponent(query)}`)
      if (!res.ok) throw new Error(res.status === 429 ? 'Yahoo limita las llamadas. Espera un poco.' : `El proxy de Yahoo respondió con el error ${res.status}.`)
      const data = (await res.json()) as { results?: ProxyResult[] }
      const seen = new Set<string>()
      const hits: SearchHit[] = []
      for (const r of data.results ?? []) {
        if (!r.symbol || seen.has(r.symbol)) continue
        seen.add(r.symbol)
        hits.push({
          symbol: r.symbol,
          name: r.name || r.symbol,
          type: mapYahooType(r.type),
          // La divisa real llega con la cotización; hasta entonces, la habitual de esa bolsa.
          currency: guessCurrency(r.symbol),
          exchange: r.exchange ?? undefined,
        })
        if (hits.length === 8) break
      }
      return hits
    },
  }
}

/**
 * Comprueba que el proxy está bien desplegado pidiéndole una cotización y un
 * histórico de prueba. Si responde a lo primero pero no a lo segundo, es una
 * versión antigua del código del Worker.
 */
export async function testYahooProxy(
  proxyUrl: string,
  fetcher: Fetcher = (...a) => fetch(...a),
): Promise<{ ok: boolean; message: string; outdated?: boolean }> {
  const url = normalizeProxyUrl(proxyUrl)
  if (!url) return { ok: false, message: 'La dirección debe empezar por https:// (p. ej. https://buho-yahoo.tu-usuario.workers.dev).' }
  const probe: Asset = { id: 'test', name: 'Prueba', type: 'accion', currency: 'EUR', ticker: 'SAN.MC', createdAt: '', updatedAt: '' }
  const provider = createYahooProvider(url, fetcher)
  const r = await provider.getQuotes([probe])
  const q = r.quotes.get('test')
  if (!q) return { ok: false, message: r.errors.get('test') ?? 'No se pudo comprobar el proxy.' }
  const quoteMsg = `Funciona: Banco Santander (SAN.MC) cotiza a ${q.price} ${q.currency}.`
  try {
    const days = await provider.history!(probe, '1mo')
    return { ok: true, message: `${quoteMsg} El histórico también (${days.length} días de prueba).` }
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    if (/error 404|error 400/.test(message)) {
      return { ok: true, outdated: true, message: `${quoteMsg} Pero tu proxy es de una versión antigua y no tiene histórico: actualiza su código (ver la guía).` }
    }
    return { ok: true, message: `${quoteMsg} El histórico no ha respondido: ${message}` }
  }
}
