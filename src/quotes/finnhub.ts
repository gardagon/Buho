import { Decimal } from '../domain/numbers'
import type { Asset, Quote } from '../domain/types'
import type { Fetcher, PriceProvider, QuoteResult } from './types'

const BASE = 'https://finnhub.io/api/v1'
/** El plan gratuito permite 60 llamadas por minuto; vamos de 5 en 5. */
const BATCH = 5

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
