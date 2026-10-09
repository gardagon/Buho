import type { FxRates } from '../domain/types'
import type { Fetcher } from './types'

const BASE = 'https://api.frankfurter.dev/v1'

/**
 * Tipos de cambio actuales del BCE vía Frankfurter (gratis y sin clave).
 * Devuelve unidades de cada divisa por 1 EUR, como en `Movement.fxRate`.
 */
export async function fetchFxRates(currencies: string[], fetcher: Fetcher = (...a) => fetch(...a)): Promise<FxRates> {
  const wanted = [...new Set(currencies.filter((c) => c !== 'EUR'))]
  if (wanted.length === 0) return { date: new Date().toISOString().slice(0, 10), rates: {} }
  const res = await fetcher(`${BASE}/latest?base=EUR&symbols=${wanted.join(',')}`)
  if (!res.ok) throw new Error(`No se pudieron pedir los tipos de cambio (error ${res.status}).`)
  const data = (await res.json()) as { date?: string; rates?: Record<string, number> }
  if (!data.rates || !data.date) throw new Error('Los tipos de cambio llegaron en un formato inesperado.')
  const rates: FxRates['rates'] = {}
  for (const [c, v] of Object.entries(data.rates)) rates[c] = String(v)
  return { date: data.date, rates }
}

/**
 * Cambio del BCE de un día: unidades de `currency` por 1 EUR. Si ese día no hubo
 * publicación (fin de semana, festivo), Frankfurter da el último anterior y
 * `date` dice cuál es.
 */
export async function fetchRateOn(
  currency: string,
  date: string,
  fetcher: Fetcher = (...a) => fetch(...a),
): Promise<{ rate: string; date: string }> {
  const res = await fetcher(`${BASE}/${date}?base=EUR&symbols=${currency}`)
  if (!res.ok) throw new Error(`No se pudo pedir el cambio del ${date} (error ${res.status}).`)
  const data = (await res.json()) as { date?: string; rates?: Record<string, number> }
  const rate = data.rates?.[currency]
  if (!rate || !data.date) throw new Error(`El BCE no tiene cambio de ${currency} para esa fecha.`)
  return { rate: String(rate), date: data.date }
}

/** Cambio del BCE de un día para guardarlo con un precio; `undefined` si no hay conexión o es EUR. */
export async function rateForPoint(currency: string, date: string): Promise<string | undefined> {
  if (currency === 'EUR') return undefined
  try {
    return (await fetchRateOn(currency, date)).rate
  } catch {
    return undefined
  }
}
