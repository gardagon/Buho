import { Decimal, d } from './numbers'
import type { Asset, Movement } from './types'

/**
 * Cálculo de cartera a coste, con criterio FIFO (el que exige Hacienda en
 * España para valores homogéneos): en cada venta salen primero los títulos
 * comprados antes.
 *
 * Todo se lleva en EUR usando el tipo de cambio de la fecha de cada
 * operación. Las comisiones suman al coste de compra y restan del importe de
 * venta.
 *
 * Pendiente (ver README): regla de los dos meses, splits, traspasos entre
 * fondos y derechos de suscripción.
 */

export interface Lot {
  movementId: string
  date: string
  quantity: Decimal
  /** Coste por título en EUR, comisiones incluidas. */
  unitCostEur: Decimal
  /** Coste por título en la divisa original, comisiones incluidas. */
  unitCost: Decimal
}

export interface Position {
  asset: Asset
  quantity: Decimal
  costEur: Decimal
  /** Coste en la divisa de cotización del activo. */
  cost: Decimal
  avgCostEur: Decimal
  avgCost: Decimal
  lots: Lot[]
}

export interface RealizedSale {
  movementId: string
  asset: Asset
  date: string
  quantity: Decimal
  proceedsEur: Decimal
  costEur: Decimal
  gainEur: Decimal
  /** Lotes consumidos, con la fecha de compra de cada uno. */
  matched: { buyMovementId: string; buyDate: string; quantity: Decimal; costEur: Decimal }[]
}

export interface IncomeEntry {
  movementId: string
  asset: Asset
  date: string
  type: 'dividendo' | 'cupon'
  grossEur: Decimal
  withholdingEur: Decimal
  netEur: Decimal
}

export interface PortfolioIssue {
  movementId: string
  assetId: string
  message: string
}

export interface Portfolio {
  positions: Position[]
  sales: RealizedSale[]
  income: IncomeEntry[]
  issues: PortfolioIssue[]
  totalCostEur: Decimal
}

const ZERO = new Decimal(0)

/** Importe en divisa → EUR. `fxRate` = unidades de divisa por 1 EUR. */
export function toEur(amount: Decimal, fxRate: string | undefined): Decimal {
  const fx = d(fxRate || 1)
  if (fx.lte(0)) return amount
  return amount.div(fx)
}

export function sortMovements(movements: Movement[]): Movement[] {
  return [...movements].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    // Mismo día: compras antes que ventas, para no dejar ventas "en descubierto".
    const rank = (m: Movement) => (m.type === 'compra' ? 0 : m.type === 'venta' ? 2 : 1)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  })
}

export function computePortfolio(assets: Asset[], movements: Movement[]): Portfolio {
  const assetById = new Map(assets.filter((a) => !a.deleted).map((a) => [a.id, a]))
  const lotsByAsset = new Map<string, Lot[]>()
  const sales: RealizedSale[] = []
  const income: IncomeEntry[] = []
  const issues: PortfolioIssue[] = []

  for (const m of sortMovements(movements.filter((m) => !m.deleted))) {
    const asset = assetById.get(m.assetId)
    if (!asset) {
      issues.push({ movementId: m.id, assetId: m.assetId, message: 'El movimiento apunta a un activo que no existe.' })
      continue
    }
    const lots = lotsByAsset.get(asset.id) ?? []
    lotsByAsset.set(asset.id, lots)
    const fees = d(m.fees)

    if (m.type === 'compra') {
      const qty = d(m.quantity)
      if (qty.lte(0)) {
        issues.push({ movementId: m.id, assetId: asset.id, message: 'Compra sin cantidad.' })
        continue
      }
      const gross = qty.mul(d(m.price)).plus(fees)
      lots.push({
        movementId: m.id,
        date: m.date,
        quantity: qty,
        unitCost: gross.div(qty),
        unitCostEur: toEur(gross, m.fxRate).div(qty),
      })
    } else if (m.type === 'venta') {
      let remaining = d(m.quantity)
      if (remaining.lte(0)) {
        issues.push({ movementId: m.id, assetId: asset.id, message: 'Venta sin cantidad.' })
        continue
      }
      const soldQty = remaining
      const proceedsEur = toEur(soldQty.mul(d(m.price)).minus(fees), m.fxRate)
      let costEur = ZERO
      const matched: RealizedSale['matched'] = []
      while (remaining.gt(0) && lots.length > 0) {
        const lot = lots[0]
        const take = Decimal.min(lot.quantity, remaining)
        const c = take.mul(lot.unitCostEur)
        costEur = costEur.plus(c)
        matched.push({ buyMovementId: lot.movementId, buyDate: lot.date, quantity: take, costEur: c })
        lot.quantity = lot.quantity.minus(take)
        remaining = remaining.minus(take)
        if (lot.quantity.lte(0)) lots.shift()
      }
      if (remaining.gt(0)) {
        issues.push({
          movementId: m.id,
          assetId: asset.id,
          message: `Vendes ${soldQty.toString()} títulos pero solo tenías ${soldQty.minus(remaining).toString()}. Revisa las compras anteriores.`,
        })
      }
      sales.push({
        movementId: m.id,
        asset,
        date: m.date,
        quantity: soldQty,
        proceedsEur,
        costEur,
        gainEur: proceedsEur.minus(costEur),
        matched,
      })
    } else {
      const grossEur = toEur(d(m.amount), m.fxRate)
      const withholdingEur = toEur(d(m.withholding), m.fxRate)
      income.push({
        movementId: m.id,
        asset,
        date: m.date,
        type: m.type,
        grossEur,
        withholdingEur,
        netEur: grossEur.minus(withholdingEur).minus(toEur(fees, m.fxRate)),
      })
    }
  }

  const positions: Position[] = []
  for (const [assetId, lots] of lotsByAsset) {
    const quantity = lots.reduce((s, l) => s.plus(l.quantity), ZERO)
    if (quantity.lte(0)) continue
    const costEur = lots.reduce((s, l) => s.plus(l.quantity.mul(l.unitCostEur)), ZERO)
    const cost = lots.reduce((s, l) => s.plus(l.quantity.mul(l.unitCost)), ZERO)
    positions.push({
      asset: assetById.get(assetId)!,
      quantity,
      costEur,
      cost,
      avgCostEur: costEur.div(quantity),
      avgCost: cost.div(quantity),
      lots,
    })
  }
  positions.sort((a, b) => b.costEur.cmp(a.costEur))

  return {
    positions,
    sales,
    income,
    issues,
    totalCostEur: positions.reduce((s, p) => s.plus(p.costEur), ZERO),
  }
}

export interface YearSummary {
  year: string
  gainsEur: Decimal
  lossesEur: Decimal
  netGainEur: Decimal
  incomeGrossEur: Decimal
  withholdingEur: Decimal
}

export function summarizeByYear(p: Portfolio): YearSummary[] {
  const map = new Map<string, YearSummary>()
  const get = (year: string) => {
    let y = map.get(year)
    if (!y) {
      y = { year, gainsEur: ZERO, lossesEur: ZERO, netGainEur: ZERO, incomeGrossEur: ZERO, withholdingEur: ZERO }
      map.set(year, y)
    }
    return y
  }
  for (const s of p.sales) {
    const y = get(s.date.slice(0, 4))
    if (s.gainEur.gte(0)) y.gainsEur = y.gainsEur.plus(s.gainEur)
    else y.lossesEur = y.lossesEur.plus(s.gainEur)
    y.netGainEur = y.netGainEur.plus(s.gainEur)
  }
  for (const i of p.income) {
    const y = get(i.date.slice(0, 4))
    y.incomeGrossEur = y.incomeGrossEur.plus(i.grossEur)
    y.withholdingEur = y.withholdingEur.plus(i.withholdingEur)
  }
  return [...map.values()].sort((a, b) => (a.year < b.year ? 1 : -1))
}
