import { Decimal, d } from './numbers'
import type { Position } from './portfolio'
import type { Asset, FxRates, PricePoint, Quote, QuoteDay } from './types'

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
          currency: asset.manualPriceCurrency ?? asset.currency,
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

/**
 * El mismo precio en la otra moneda, para compararlo: si está en euros, lo da en
 * dólares; si está en otra divisa, lo da en euros. `undefined` si falta el cambio.
 */
export function counterPrice(price: PriceInfo, fx?: FxRates): { amount: Decimal; currency: string } | undefined {
  if (price.currency === 'EUR') {
    const usd = fx?.rates.USD
    return usd && d(usd).gt(0) ? { amount: price.price.mul(d(usd)), currency: 'USD' } : undefined
  }
  const eur = priceToEur(price.price, price.currency, fx)
  return eur ? { amount: eur, currency: 'EUR' } : undefined
}

export interface HistoryPoint {
  date: string
  /** Precio en EUR. */
  eur: Decimal
  source: 'manual' | 'mercado'
}

/**
 * Serie del histórico en EUR, ordenada por fecha. Cada punto se pasa a euros con
 * el cambio de su día si se guardó, y si no con el cambio actual. Los puntos de
 * una divisa sin cambio disponible se dejan fuera. Si un día tiene precio manual
 * y cotización, gana el manual (es lo que la persona puso a propósito).
 */
export function priceHistory(manual: PricePoint[], market: QuoteDay[], fx?: FxRates): HistoryPoint[] {
  const byDate = new Map<string, HistoryPoint>()
  const add = (date: string, price: string, currency: string, rate: string | undefined, source: HistoryPoint['source']) => {
    const base = d(price)
    let eur: Decimal | undefined
    if (currency === 'EUR') eur = base
    else if (rate && d(rate).gt(0)) eur = base.div(d(rate))
    else eur = priceToEur(base, currency, fx)
    if (eur) byDate.set(date, { date, eur, source })
  }
  for (const m of market) add(m.date, m.price, m.currency, undefined, 'mercado')
  for (const p of manual) if (!p.deleted) add(p.date, p.price, p.currency, p.fxRate, 'manual')
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** Cambia un importe de una divisa a otra pasando por el euro. `undefined` si falta algún cambio. */
export function convertAmount(amount: Decimal, from: string, to: string, fx?: FxRates): Decimal | undefined {
  if (from === to) return amount
  const eur = priceToEur(amount, from, fx)
  if (!eur) return undefined
  if (to === 'EUR') return eur
  const rate = fx?.rates[to]
  return rate && d(rate).gt(0) ? eur.mul(d(rate)) : undefined
}

export type BaseCurrency = 'EUR' | 'USD'

/**
 * Cómo se enseña un precio: en la moneda principal elegida y, más pequeño, su
 * equivalente en la otra (euros ↔ dólares). Si no se puede convertir, se enseña
 * tal cual viene.
 */
export function displayPrice(
  price: PriceInfo,
  base: BaseCurrency,
  fx?: FxRates,
): { main: { amount: Decimal; currency: string }; other?: { amount: Decimal; currency: string } } {
  const mainAmount = convertAmount(price.price, price.currency, base, fx)
  const main = mainAmount ? { amount: mainAmount, currency: base } : { amount: price.price, currency: price.currency }
  const otherCurrency = base === 'EUR' ? 'USD' : 'EUR'
  const otherAmount = convertAmount(price.price, price.currency, otherCurrency, fx)
  return { main, other: otherAmount && main.currency === base ? { amount: otherAmount, currency: otherCurrency } : undefined }
}
