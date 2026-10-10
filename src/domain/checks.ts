import { d } from './numbers'
import type { Movement, QuoteDay } from './types'

export interface PriceCheck {
  /** `fuera`: el precio queda fuera del mínimo y máximo de ese día; `sin-datos`: no se puede comprobar. */
  status: 'ok' | 'fuera' | 'sin-datos'
  low?: string
  high?: string
  currency?: string
}

/** Margen sobre el mínimo y el máximo del día: los cierres de otros mercados o el horario ampliado se salen un poco. */
const TOLERANCE = 0.01

/**
 * ¿El precio de una compra o venta cuadra con lo que cotizó ese día? Sirve para
 * cazar errores al teclear: un precio en dólares puesto como euros, una coma de
 * más o una fecha equivocada. Solo compara si el histórico está en la misma divisa;
 * un split posterior puede dar falsos avisos en valores antiguos.
 */
export function checkTradePrice(m: Movement, day?: QuoteDay): PriceCheck {
  if ((m.type !== 'compra' && m.type !== 'venta') || !m.price || !day?.low || !day.high || day.currency !== m.currency) {
    return { status: 'sin-datos' }
  }
  const price = d(m.price)
  const out = price.lt(d(day.low).mul(1 - TOLERANCE)) || price.gt(d(day.high).mul(1 + TOLERANCE))
  return { status: out ? 'fuera' : 'ok', low: day.low, high: day.high, currency: day.currency }
}
