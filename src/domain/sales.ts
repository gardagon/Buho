import { Decimal, d } from './numbers'
import { toEur, type Portfolio } from './portfolio'
import type { Asset, Movement } from './types'

/** La parte de una venta que sale de una compra concreta (FIFO). */
export interface SalePiece {
  buyMovementId: string
  buyDate: string
  quantity: Decimal
  /** Precio por título de la compra, en la divisa en que se puso. */
  buyPrice: Decimal
  buyCurrency: string
  /** Coste de adquisición de esos títulos, en EUR, con comisiones. */
  costEur: Decimal
  /** Parte del importe y de las comisiones de la venta que corresponde a estos títulos, en EUR. */
  grossEur: Decimal
  feesEur: Decimal
  proceedsEur: Decimal
  profitEur: Decimal
  /** Beneficio sobre el coste (0,10 = +10 %). */
  profitPct?: Decimal
  holdingDays: number
}

export interface SaleDetail {
  movementId: string
  date: string
  quantity: Decimal
  /** Precio por título de la venta, en la divisa en que se puso. */
  price: Decimal
  currency: string
  fxRate: string
  account?: string
  /** Cantidad × precio pasada a EUR, antes de comisiones. */
  grossEur: Decimal
  feesEur: Decimal
  /** Valor de transmisión: lo ingresado, ya sin comisiones. */
  proceedsEur: Decimal
  costEur: Decimal
  profitEur: Decimal
  profitPct?: Decimal
  pieces: SalePiece[]
}

export interface IncomeLine {
  movementId: string
  date: string
  type: 'dividendo' | 'cupon'
  grossEur: Decimal
  withholdingEur: Decimal
  feesEur: Decimal
  netEur: Decimal
}

/** Importes de un tipo de rendimiento (dividendos o cupones) en un año, en EUR. */
export interface IncomeTotals {
  grossEur: Decimal
  withholdingEur: Decimal
  netEur: Decimal
}

export interface AssetYear {
  asset: Asset
  sales: SaleDetail[]
  proceedsEur: Decimal
  costEur: Decimal
  profitEur: Decimal
  profitPct?: Decimal
  incomes: IncomeLine[]
  incomeGrossEur: Decimal
  withholdingEur: Decimal
  incomeNetEur: Decimal
  dividends: IncomeTotals
  coupons: IncomeTotals
  /** Resultado del valor en el año: beneficio de las ventas + dividendos y cupones netos de retención. */
  totalEur: Decimal
}

export interface YearReport {
  year: string
  assets: AssetYear[]
  proceedsEur: Decimal
  costEur: Decimal
  /** Suma de las ventas con beneficio. */
  gainsEur: Decimal
  /** Suma de las ventas con pérdida (en negativo). */
  lossesEur: Decimal
  netEur: Decimal
  incomeGrossEur: Decimal
  withholdingEur: Decimal
  incomeNetEur: Decimal
  dividends: IncomeTotals
  coupons: IncomeTotals
  /** Resultado del año: beneficio de las ventas + dividendos y cupones netos de retención. */
  totalEur: Decimal
}

const ZERO = new Decimal(0)
const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.plus(x), ZERO)
const dayDiff = (from: string, to: string) =>
  Math.round((new Date(to + 'T12:00:00Z').getTime() - new Date(from + 'T12:00:00Z').getTime()) / 86_400_000)

/** Años en los que hubo ventas o rendimientos, del más reciente al más antiguo. */
export function yearsWithActivity(portfolio: Portfolio): string[] {
  const years = new Set<string>()
  for (const s of portfolio.sales) years.add(s.date.slice(0, 4))
  for (const i of portfolio.income) years.add(i.date.slice(0, 4))
  return [...years].sort().reverse()
}

/**
 * Todo lo de un año: por valor, cada venta con las compras de las que salen los
 * títulos (FIFO), y los dividendos y cupones. Si una venta sale de varias
 * compras, su importe y sus comisiones se reparten por títulos.
 */
export function yearReport(portfolio: Portfolio, movements: Movement[], year: string): YearReport {
  const byId = new Map(movements.filter((m) => !m.deleted).map((m) => [m.id, m]))
  const assets = new Map<string, AssetYear>()
  const get = (asset: Asset): AssetYear => {
    let a = assets.get(asset.id)
    if (!a) {
      a = {
        asset, sales: [], proceedsEur: ZERO, costEur: ZERO, profitEur: ZERO, incomes: [],
        incomeGrossEur: ZERO, withholdingEur: ZERO, incomeNetEur: ZERO,
        dividends: { grossEur: ZERO, withholdingEur: ZERO, netEur: ZERO },
        coupons: { grossEur: ZERO, withholdingEur: ZERO, netEur: ZERO },
        totalEur: ZERO,
      }
      assets.set(asset.id, a)
    }
    return a
  }

  for (const s of portfolio.sales.filter((x) => x.date.startsWith(year))) {
    const m = byId.get(s.movementId)
    const fxRate = m?.fxRate ?? '1'
    const grossEur = m ? toEur(d(m.quantity).mul(d(m.price)), fxRate) : s.proceedsEur
    const feesEur = grossEur.minus(s.proceedsEur)
    const pieces = s.matched.map((p): SalePiece => {
      const buy = byId.get(p.buyMovementId)
      // Se multiplica antes de dividir para no arrastrar redondeos (5/15 no es exacto, 1500/15 sí).
      const part = (x: Decimal) => x.mul(p.quantity).div(s.quantity)
      const proceedsEur = part(s.proceedsEur)
      const profitEur = proceedsEur.minus(p.costEur)
      return {
        buyMovementId: p.buyMovementId,
        buyDate: p.buyDate,
        quantity: p.quantity,
        buyPrice: d(buy?.price),
        buyCurrency: buy?.currency ?? 'EUR',
        costEur: p.costEur,
        grossEur: part(grossEur),
        feesEur: part(feesEur),
        proceedsEur,
        profitEur,
        profitPct: p.costEur.gt(0) ? profitEur.div(p.costEur) : undefined,
        holdingDays: dayDiff(p.buyDate, s.date),
      }
    })
    const a = get(s.asset)
    a.sales.push({
      movementId: s.movementId,
      date: s.date,
      quantity: s.quantity,
      price: d(m?.price),
      currency: m?.currency ?? 'EUR',
      fxRate,
      account: m?.account,
      grossEur,
      feesEur,
      proceedsEur: s.proceedsEur,
      costEur: s.costEur,
      profitEur: s.gainEur,
      profitPct: s.costEur.gt(0) ? s.gainEur.div(s.costEur) : undefined,
      pieces,
    })
  }

  for (const i of portfolio.income.filter((x) => x.date.startsWith(year))) {
    get(i.asset).incomes.push({
      movementId: i.movementId,
      date: i.date,
      type: i.type,
      grossEur: i.grossEur,
      withholdingEur: i.withholdingEur,
      feesEur: i.grossEur.minus(i.withholdingEur).minus(i.netEur),
      netEur: i.netEur,
    })
  }

  const list = [...assets.values()].sort((a, b) => a.asset.name.localeCompare(b.asset.name, 'es'))
  for (const a of list) {
    a.sales.sort((x, y) => (x.date < y.date ? -1 : 1))
    a.incomes.sort((x, y) => (x.date < y.date ? -1 : 1))
    a.proceedsEur = sum(a.sales.map((s) => s.proceedsEur))
    a.costEur = sum(a.sales.map((s) => s.costEur))
    a.profitEur = a.proceedsEur.minus(a.costEur)
    a.profitPct = a.costEur.gt(0) ? a.profitEur.div(a.costEur) : undefined
    a.incomeGrossEur = sum(a.incomes.map((i) => i.grossEur))
    a.withholdingEur = sum(a.incomes.map((i) => i.withholdingEur))
    a.incomeNetEur = sum(a.incomes.map((i) => i.netEur))
    const totals = (type: IncomeLine['type']): IncomeTotals => {
      const xs = a.incomes.filter((i) => i.type === type)
      return { grossEur: sum(xs.map((i) => i.grossEur)), withholdingEur: sum(xs.map((i) => i.withholdingEur)), netEur: sum(xs.map((i) => i.netEur)) }
    }
    a.dividends = totals('dividendo')
    a.coupons = totals('cupon')
    a.totalEur = a.profitEur.plus(a.incomeNetEur)
  }

  const allSales = list.flatMap((a) => a.sales)
  return {
    year,
    assets: list,
    proceedsEur: sum(allSales.map((s) => s.proceedsEur)),
    costEur: sum(allSales.map((s) => s.costEur)),
    gainsEur: sum(allSales.filter((s) => s.profitEur.gte(0)).map((s) => s.profitEur)),
    lossesEur: sum(allSales.filter((s) => s.profitEur.lt(0)).map((s) => s.profitEur)),
    netEur: sum(allSales.map((s) => s.profitEur)),
    incomeGrossEur: sum(list.map((a) => a.incomeGrossEur)),
    withholdingEur: sum(list.map((a) => a.withholdingEur)),
    incomeNetEur: sum(list.map((a) => a.incomeNetEur)),
    dividends: {
      grossEur: sum(list.map((a) => a.dividends.grossEur)),
      withholdingEur: sum(list.map((a) => a.dividends.withholdingEur)),
      netEur: sum(list.map((a) => a.dividends.netEur)),
    },
    coupons: {
      grossEur: sum(list.map((a) => a.coupons.grossEur)),
      withholdingEur: sum(list.map((a) => a.coupons.withholdingEur)),
      netEur: sum(list.map((a) => a.coupons.netEur)),
    },
    totalEur: sum(allSales.map((s) => s.profitEur)).plus(sum(list.map((a) => a.incomeNetEur))),
  }
}
