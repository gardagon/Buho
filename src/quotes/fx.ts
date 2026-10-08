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
