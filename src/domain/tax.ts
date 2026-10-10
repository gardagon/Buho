import { Decimal } from './numbers'
import type { YearReport } from './sales'

/**
 * Estimación de lo que se pagaría a Hacienda por la base imponible del ahorro
 * (ventas de acciones y fondos, dividendos y cupones) de cada año. Es una
 * aproximación para territorio común: no sustituye al borrador de la Agencia
 * Tributaria ni a un asesor. Ver docs/FISCALIDAD.md.
 */

const ZERO = new Decimal(0)

/** Tramos de la escala del ahorro: [desde, hasta, tipo]. `null` = sin tope. */
export type Bracket = readonly [number, number | null, number]

/**
 * Escala del ahorro (estatal + autonómica) de cada año. Antes de 2021 solo hay tres
 * tramos; desde 2021 se añade uno a partir de 200.000 €; en 2024 se parte en 27 % y
 * 28 %, y desde 2025 el último sube al 30 % (las fuentes discrepan sobre ese último
 * tramo; afecta solo a bases de más de 300.000 €).
 */
export function savingsBrackets(year: number): { brackets: Bracket[]; note?: string } {
  const base: Bracket[] = [
    [0, 6000, 0.19],
    [6000, 50000, 0.21],
  ]
  if (year <= 2020) return { brackets: [...base, [50000, null, 0.23]] }
  if (year <= 2023) return { brackets: [...base, [50000, 200000, 0.23], [200000, null, 0.26]] }
  const note = 'El tipo del tramo de más de 300.000 € varía según la fuente; compruébalo si tu base lo alcanza.'
  if (year === 2024) return { brackets: [...base, [50000, 200000, 0.23], [200000, 300000, 0.27], [300000, null, 0.28]], note }
  return { brackets: [...base, [50000, 200000, 0.23], [200000, 300000, 0.27], [300000, null, 0.3]], note }
}

export interface BracketLine {
  from: number
  to: number | null
  rate: number
  /** Parte de la base que cae en este tramo. */
  base: Decimal
  tax: Decimal
}

export function applyBrackets(base: Decimal, brackets: Bracket[]): { lines: BracketLine[]; tax: Decimal } {
  const lines: BracketLine[] = []
  let tax = ZERO
  for (const [from, to, rate] of brackets) {
    const top = to === null ? base : Decimal.min(base, to)
    const part = top.minus(from)
    if (part.lte(0)) continue
    const t = part.mul(rate)
    lines.push({ from, to, rate, base: part, tax: t })
    tax = tax.plus(t)
  }
  return { lines, tax }
}

export interface PendingLoss {
  /** Año en que se produjo la pérdida. */
  year: number
  amount: Decimal
}

export interface TaxEstimate {
  year: string
  /** Saldo de ganancias y pérdidas patrimoniales por ventas del año. */
  salesEur: Decimal
  /** Dividendos y cupones brutos del año (rendimientos del capital mobiliario). */
  incomeEur: Decimal
  /** Pérdidas de años anteriores compensadas con las ganancias de este año. */
  carryAgainstSalesEur: Decimal
  /** Pérdidas (de este año y anteriores) compensadas con dividendos y cupones, hasta el 25 %. */
  lossAgainstIncomeEur: Decimal
  taxableSalesEur: Decimal
  taxableIncomeEur: Decimal
  baseEur: Decimal
  brackets: BracketLine[]
  cuotaEur: Decimal
  /** Retenciones e ingresos a cuenta ya practicados sobre dividendos y cupones. */
  withholdingEur: Decimal
  /** Cuota − retenciones. Positivo: a pagar. Negativo: a devolver. */
  resultEur: Decimal
  /** Cuota sobre la base (tipo medio), si hay base. */
  effectiveRate?: Decimal
  /** Pérdidas que se podrán compensar en los años siguientes. */
  pendingLosses: PendingLoss[]
  note?: string
}

const LIMIT = 0.25 // art. 49 LIRPF: límite de compensación entre las dos clases de renta
const YEARS_FORWARD = 4

/**
 * Calcula la base imponible del ahorro y la cuota de un año (art. 49 y 66 LIRPF):
 *
 * 1. Las ganancias y pérdidas por ventas se compensan entre sí sin límite.
 * 2. Las pérdidas de los 4 años anteriores que sigan pendientes se aplican, de la más
 *    antigua a la más reciente, contra las ganancias del año.
 * 3. Si queda un saldo negativo (del año o de años anteriores), solo se compensa con
 *    los dividendos y cupones hasta el 25 % de estos; el límite lo comparten las
 *    pérdidas del año y las arrastradas.
 * 4. Lo que no se pueda compensar queda pendiente 4 años.
 *
 * Los dividendos y cupones tributan por el importe bruto; sus retenciones se
 * restan de la cuota. Solo ve los datos que hay en Buho: si faltan años anteriores,
 * faltarán sus pérdidas pendientes.
 */
export function estimateTax(reports: YearReport[], year: string): TaxEstimate | undefined {
  const target = Number(year)
  const years = reports.map((r) => Number(r.year)).filter((y) => y <= target)
  if (years.length === 0 || !years.includes(target)) return undefined
  const byYear = new Map(reports.map((r) => [Number(r.year), r]))

  let pending: PendingLoss[] = []
  let result: TaxEstimate | undefined

  for (let y = Math.min(...years); y <= target; y++) {
    const r = byYear.get(y)
    const sales = r?.netEur ?? ZERO
    const income = r?.incomeGrossEur ?? ZERO
    const withholding = r?.withholdingEur ?? ZERO

    // Pérdidas que ya han caducado (más de 4 años), de la más antigua a la más reciente.
    pending = pending.filter((p) => p.year >= y - YEARS_FORWARD && p.amount.gt(0)).sort((a, b) => a.year - b.year)

    // Pérdidas anteriores contra las ganancias del año.
    let carryAgainstSales = ZERO
    if (sales.gt(0)) {
      for (const p of pending) {
        const use = Decimal.min(p.amount, sales.minus(carryAgainstSales))
        p.amount = p.amount.minus(use)
        carryAgainstSales = carryAgainstSales.plus(use)
      }
    }
    const salesLeft = sales.minus(carryAgainstSales)

    // Lo que quede en negativo, contra los dividendos y cupones (hasta el 25 %).
    let capLeft = income.mul(LIMIT)
    let lossAgainstIncome = ZERO
    for (const p of pending) {
      const use = Decimal.min(p.amount, capLeft)
      p.amount = p.amount.minus(use)
      capLeft = capLeft.minus(use)
      lossAgainstIncome = lossAgainstIncome.plus(use)
    }
    let taxableSales = Decimal.max(salesLeft, ZERO)
    if (salesLeft.lt(0)) {
      const loss = salesLeft.neg()
      const use = Decimal.min(loss, capLeft)
      lossAgainstIncome = lossAgainstIncome.plus(use)
      if (loss.minus(use).gt(0)) pending.push({ year: y, amount: loss.minus(use) })
      taxableSales = ZERO
    }
    pending = pending.filter((p) => p.amount.gt(0))

    if (y === target) {
      const taxableIncome = income.minus(lossAgainstIncome)
      const base = taxableSales.plus(taxableIncome)
      const { brackets, note } = savingsBrackets(y)
      const { lines, tax } = applyBrackets(base, brackets)
      result = {
        year,
        salesEur: sales,
        incomeEur: income,
        carryAgainstSalesEur: carryAgainstSales,
        lossAgainstIncomeEur: lossAgainstIncome,
        taxableSalesEur: taxableSales,
        taxableIncomeEur: taxableIncome,
        baseEur: base,
        brackets: lines,
        cuotaEur: tax,
        withholdingEur: withholding,
        resultEur: tax.minus(withholding),
        effectiveRate: base.gt(0) ? tax.div(base) : undefined,
        pendingLosses: pending.map((p) => ({ ...p })),
        note: base.gt(300000) ? note : undefined,
      }
    }
  }
  return result
}
