import { Decimal, d } from './numbers'
import { buyCostEur, sortMovements, type Portfolio } from './portfolio'
import type { Movement } from './types'

/** La parte de una venta que sale de una compra concreta (FIFO). */
export interface LotSlice {
  saleMovementId: string
  date: string
  quantity: Decimal
  /** Precio por título de la venta, en la divisa en que se puso. */
  price: Decimal
  currency: string
  /** Importe neto de esa parte de la venta, en EUR (las comisiones se reparten por títulos). */
  proceedsEur: Decimal
  costEur: Decimal
  profitEur: Decimal
  /** Beneficio sobre el coste de esa parte (0,10 = +10 %). */
  profitPct?: Decimal
}

export interface LotDetail {
  buy: Movement
  quantity: Decimal
  /** Lo que costó la compra entera, en EUR, comisiones incluidas. */
  costEur: Decimal
  unitCostEur: Decimal
  /** Títulos de esta compra que aún se tienen. */
  remaining: Decimal
  slices: LotSlice[]
  /** Beneficio ya realizado con las ventas de esta compra. */
  realizedProfitEur: Decimal
  status: 'abierta' | 'parcial' | 'vendida'
}

/**
 * Estado de cada compra de un activo: cuánto queda y a qué ventas se ha ido,
 * según el criterio FIFO que usa `computePortfolio`. Si una venta sale de
 * varias compras, su importe y sus comisiones se reparten en proporción a los
 * títulos de cada una.
 */
export function lotDetails(portfolio: Portfolio, assetId: string, movements: Movement[]): LotDetail[] {
  const mine = movements.filter((m) => !m.deleted && m.assetId === assetId)
  const byId = new Map(mine.map((m) => [m.id, m]))
  const open = new Map(
    (portfolio.positions.find((p) => p.asset.id === assetId)?.lots ?? []).map((l) => [l.movementId, l.quantity]),
  )

  const slices = new Map<string, LotSlice[]>()
  for (const sale of portfolio.sales.filter((s) => s.asset.id === assetId)) {
    const m = byId.get(sale.movementId)
    for (const piece of sale.matched) {
      const proceedsEur = sale.proceedsEur.mul(piece.quantity).div(sale.quantity)
      const profitEur = proceedsEur.minus(piece.costEur)
      const list = slices.get(piece.buyMovementId) ?? []
      list.push({
        saleMovementId: sale.movementId,
        date: sale.date,
        quantity: piece.quantity,
        price: d(m?.price),
        currency: m?.currency ?? 'EUR',
        proceedsEur,
        costEur: piece.costEur,
        profitEur,
        profitPct: piece.costEur.gt(0) ? profitEur.div(piece.costEur) : undefined,
      })
      slices.set(piece.buyMovementId, list)
    }
  }

  return sortMovements(mine.filter((m) => m.type === 'compra' && d(m.quantity).gt(0))).map((buy) => {
    const quantity = d(buy.quantity)
    const costEur = buyCostEur(buy)
    const mySlices = (slices.get(buy.id) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1))
    const remaining = open.get(buy.id) ?? new Decimal(0)
    return {
      buy,
      quantity,
      costEur,
      unitCostEur: costEur.div(quantity),
      remaining,
      slices: mySlices,
      realizedProfitEur: mySlices.reduce((s, x) => s.plus(x.profitEur), new Decimal(0)),
      status: remaining.gte(quantity) ? 'abierta' : remaining.gt(0) ? 'parcial' : 'vendida',
    }
  })
}
