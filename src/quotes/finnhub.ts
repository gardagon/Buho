import { Decimal } from '../domain/numbers'
import type { Asset, AssetType, Quote } from '../domain/types'
import type { Fetcher, PriceProvider, QuoteResult, SearchHit } from './types'

const BASE = 'https://finnhub.io/api/v1'
/** El plan gratuito permite 60 llamadas por minuto; vamos de 5 en 5. */
const BATCH = 5

interface FinnhubSearchItem {
  description?: string
  symbol?: string
  type?: string
}

/** Divisa habitual según el sufijo de bolsa de Finnhub (`SAN.MC`, `SAP.DE`…). Sin sufijo: EE. UU. */
const SUFFIX_CURRENCY: Record<string, string> = {
  MC: 'EUR', DE: 'EUR', F: 'EUR', PA: 'EUR', AS: 'EUR', MI: 'EUR', BR: 'EUR', LS: 'EUR', HE: 'EUR', VI: 'EUR', IR: 'EUR',
  L: 'GBP', SW: 'CHF', TO: 'CAD', V: 'CAD', ST: 'SEK', OL: 'NOK', CO: 'DKK', HK: 'HKD', T: 'JPY', AX: 'AUD',
}

export function guessCurrency(symbol: string): string {
  const suffix = symbol.includes('.') ? symbol.split('.').pop()! : ''
  return SUFFIX_CURRENCY[suffix] ?? 'USD'
}

function guessAssetType(finnhubType: string | undefined, symbol: string): AssetType {
  const t = (finnhubType ?? '').toLowerCase()
  if (t.includes('crypto') || symbol.includes(':')) return 'cripto'
  if (t.includes('etp') || t.includes('etf') || t.includes('fund')) return 'etf'
  return 'accion'
}

const MAX_HITS = 8

/** Siglas que se quedan en mayúsculas al pasar «BANCO SANTANDER SA» a «Banco Santander SA». */
const KEEP_UPPER = new Set(['SA', 'SE', 'AG', 'NV', 'SPA', 'AB', 'ASA', 'ETF', 'ETC', 'ETN', 'REIT', 'ADR', 'US', 'USA', 'UK', 'II', 'III', 'IV'])

export function titleCase(text: string): string {
  return text
    .split(/(\s+)/)
    .map((w) => (KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
}

interface FinnhubQuote {
  c?: number // precio actual
  pc?: number // cierre anterior
  t?: number // momento de la cotización (segundos Unix)
}

export function finnhubError(status: number): string {
  if (status === 401) return 'La clave de Finnhub no es válida. Revísala en Ajustes.'
  if (status === 403) return 'Tu plan de Finnhub no incluye este valor. El gratuito solo cubre EE. UU.; usa un precio manual.'
  if (status === 429) return 'Finnhub limita las llamadas por minuto. Espera un poco y vuelve a actualizar.'
  return `Finnhub respondió con el error ${status}.`
}

/**
 * Finnhub (REST). Con el plan gratuito solo cotizan los valores de EE. UU.:
 * BME, Xetra y similares exigen plan de pago (ver docs/DECISIONES.md).
 * El ticker se envía tal cual lo escribió la persona (`AAPL`, `SAN.MC`…).
 */
export function createFinnhubProvider(apiKey: string, fetcher: Fetcher = (...a) => fetch(...a)): PriceProvider {
  async function one(asset: Asset): Promise<Quote> {
    const url = `${BASE}/quote?symbol=${encodeURIComponent(asset.ticker!)}&token=${encodeURIComponent(apiKey)}`
    const res = await fetcher(url)
    if (!res.ok) throw new Error(finnhubError(res.status))
    const q = (await res.json()) as FinnhubQuote
    // Para un símbolo desconocido Finnhub devuelve todo a cero en vez de un error.
    if (!q.c || !q.t) throw new Error(`Finnhub no tiene datos de ${asset.ticker}. Revisa el ticker o usa un precio manual.`)
    return {
      assetId: asset.id,
      price: new Decimal(q.c).toString(),
      currency: asset.currency,
      at: new Date(q.t * 1000).toISOString(),
      prevClose: q.pc ? new Decimal(q.pc).toString() : undefined,
      provider: 'finnhub',
    }
  }

  return {
    id: 'finnhub',
    name: 'Finnhub',
    async search(query): Promise<SearchHit[]> {
      const res = await fetcher(`${BASE}/search?q=${encodeURIComponent(query)}&token=${encodeURIComponent(apiKey)}`)
      if (!res.ok) throw new Error(finnhubError(res.status))
      const data = (await res.json()) as { result?: FinnhubSearchItem[] }
      const seen = new Set<string>()
      const hits: SearchHit[] = []
      for (const r of data.result ?? []) {
        if (!r.symbol || seen.has(r.symbol)) continue
        seen.add(r.symbol)
        hits.push({
          symbol: r.symbol,
          name: r.description ? titleCase(r.description) : r.symbol,
          type: guessAssetType(r.type, r.symbol),
          currency: guessCurrency(r.symbol),
        })
        if (hits.length === MAX_HITS) break
      }
      return hits
    },
    supports: (a) => !!a.ticker && a.type !== 'fondo' && a.type !== 'bono',
    async getQuotes(assets): Promise<QuoteResult> {
      const out: QuoteResult = { quotes: new Map(), errors: new Map() }
      for (let i = 0; i < assets.length; i += BATCH) {
        await Promise.all(
          assets.slice(i, i + BATCH).map(async (a) => {
            try {
              out.quotes.set(a.id, await one(a))
            } catch (e) {
              out.errors.set(a.id, e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'Sin conexión con Finnhub.')
            }
          }),
        )
      }
      return out
    },
  }
}
