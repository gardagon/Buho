import { Decimal, d } from './numbers'
import type { Position } from './portfolio'
import type { Asset, FxRates, Quote } from './types'

/**
 * Valoración a precio de mercado. Se apoya en las posiciones a coste de
 * `computePortfolio` y no toca su cálculo FIFO.
 */

export interface PriceInfo {
  price: Decimal
  currency: string
  /** Fecha y hora de la cotización, o solo la fecha si es manual. */
  at: string
  source: 'mercado' | 'manual'
  prevClose?: Decimal
}

/**
 * Elige el precio de un activo: la cotización, salvo que el precio manual sea
 * de un día posterior (alguien lo puso a mano a propósito).
 */
export function pickPrice(asset: Asset, quote?: Quote): PriceInfo | undefined {
  const manual =
    asset.manualPrice && d(asset.manualPrice).gt(0)
      ? ({
          price: d(asset.manualPrice),
          currency: asset.currency,
          at: asset.manualPriceDate ?? '',
          source: 'manual',
        } satisfies PriceInfo)
      : undefined
  const market =
    quote && d(quote.price).gt(0)
      ? ({
          price: d(quote.price),
          currency: quote.currency,
          at: quote.at,
          source: 'mercado',
          prevClose: quote.prevClose ? d(quote.prevClose) : undefined,
        } satisfies PriceInfo)
      : undefined
  if (market && manual) return manual.at.slice(0, 10) > market.at.slice(0, 10) ? manual : market
  return market ?? manual
}

/** Precio en EUR. `undefined` si falta el tipo de cambio de esa divisa. */
export function priceToEur(price: Decimal, currency: string, fx?: FxRates): Decimal | undefined {
  if (currency === 'EUR') return price
  const rate = fx?.rates[currency]
  if (!rate || d(rate).lte(0)) return undefined
  return price.div(d(rate))
}

export interface ValuedPosition {
  position: Position
  price?: PriceInfo
  /** Valor actual en EUR. `undefined` si no hay precio o falta el cambio. */
  valueEur?: Decimal
  /** Plusvalía latente en EUR (valor − coste). */
  unrealizedEur?: Decimal
  /** Plusvalía latente sobre el coste (0,10 = +10 %). */
  unrealizedPct?: Decimal
  /** Hay precio pero no tipo de cambio para pasarlo a EUR. */
  missingFx?: boolean
}

export interface Valuation {
  rows: ValuedPosition[]
  /** Valor de mercado de las posiciones que tienen precio. */
  valueEur: Decimal
  /** Coste de esas mismas posiciones (para que el total sea comparable). */
  costOfValuedEur: Decimal
  unrealizedEur: Decimal
  unrealizedPct?: Decimal
  /** Posiciones sin valorar (sin precio o sin tipo de cambio). */
  unvalued: number
}

export function valuePositions(
  positions: Position[],
  quotes: ReadonlyMap<string, Quote>,
  fx?: FxRates,
): Valuation {
  let valueEur = new Decimal(0)
  let costOfValuedEur = new Decimal(0)
  let unvalued = 0

  const rows = positions.map((position): ValuedPosition => {
    const price = pickPrice(position.asset, quotes.get(position.asset.id))
    if (!price) {
      unvalued++
      return { position }
    }
    const unitEur = priceToEur(price.price, price.currency, fx)
    if (!unitEur) {
      unvalued++
      return { position, price, missingFx: true }
    }
    const v = position.quantity.mul(unitEur)
    const unrealizedEur = v.minus(position.costEur)
    valueEur = valueEur.plus(v)
    costOfValuedEur = costOfValuedEur.plus(position.costEur)
    return {
      position,
      price,
      valueEur: v,
      unrealizedEur,
      unrealizedPct: position.costEur.gt(0) ? unrealizedEur.div(position.costEur) : undefined,
    }
  })

  const unrealizedEur = valueEur.minus(costOfValuedEur)
  return {
    rows,
    valueEur,
    costOfValuedEur,
    unrealizedEur,
    unrealizedPct: costOfValuedEur.gt(0) ? unrealizedEur.div(costOfValuedEur) : undefined,
    unvalued,
  }
}

/** Variación del día respecto al cierre anterior (0,01 = +1 %), si se conoce. */
export function dayChange(price: PriceInfo): { abs: Decimal; pct: Decimal } | undefined {
  if (!price.prevClose || price.prevClose.lte(0)) return undefined
  const abs = price.price.minus(price.prevClose)
  return { abs, pct: abs.div(price.prevClose) }
}
