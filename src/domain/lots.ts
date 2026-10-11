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
  /** Lote heredado de otro fondo por un traspaso: `buy` es la compra original, en el fondo de origen. */
  inherited?: boolean
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
  const everyById = new Map(movements.filter((m) => !m.deleted).map((m) => [m.id, m]))
  const positionLots = portfolio.positions.find((p) => p.asset.id === assetId)?.lots ?? []
  // Un mismo lote original puede estar repartido en varios lotes del fondo de destino: se suman.
  const open = new Map<string, Decimal>()
  for (const l of positionLots) open.set(l.movementId, (open.get(l.movementId) ?? new Decimal(0)).plus(l.quantity))

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

  const own = sortMovements(mine.filter((m) => m.type === 'compra' && d(m.quantity).gt(0)))
  const ownIds = new Set(own.map((m) => m.id))
  // Lotes que llegaron por traspaso desde otro fondo: se enseñan con su compra original.
  const inherited: LotDetail[] = []
  for (const id of new Set([...open.keys(), ...slices.keys()])) {
    const buy = everyById.get(id)
    if (ownIds.has(id) || !buy) continue
    const mySlices = (slices.get(id) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1))
    const remaining = open.get(id) ?? new Decimal(0)
    const quantity = mySlices.reduce((n, x) => n.plus(x.quantity), remaining)
    const unitCostEur = positionLots.find((l) => l.movementId === id)?.unitCostEur ?? mySlices[0].costEur.div(mySlices[0].quantity)
    inherited.push({
      buy,
      quantity,
      costEur: unitCostEur.mul(quantity),
      unitCostEur,
      remaining,
      slices: mySlices,
      realizedProfitEur: mySlices.reduce((sum, x) => sum.plus(x.profitEur), new Decimal(0)),
      status: remaining.gte(quantity) ? 'abierta' : remaining.gt(0) ? 'parcial' : 'vendida',
      inherited: true,
    })
  }

  const ownDetails = own.map((buy): LotDetail => {
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
  return [...ownDetails, ...inherited].sort((a, b) => (a.buy.date < b.buy.date ? -1 : a.buy.date > b.buy.date ? 1 : 0))
}
