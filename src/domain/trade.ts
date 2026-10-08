import { Decimal } from './numbers'

/**
 * Completa una compra o venta a partir de lo que la persona sabe.
 *
 * Relación entre los datos (todo el dinero final, en EUR):
 *   compra: total = cantidad × precio ÷ cambio + comisiones
 *   venta:  total = cantidad × precio ÷ cambio − comisiones
 *
 * Con la cantidad y cualquier combinación que deje una sola incógnita entre
 * precio, comisiones, total y tipo de cambio, se despeja la que falta. Lo que
 * Hacienda necesita es el total real en EUR; las comisiones y el cambio son la
 * forma de explicar de dónde sale.
 */

export interface TradeInput {
  type: 'compra' | 'venta'
  /** Divisa en la que se introduce el precio. */
  currency: string
  quantity?: Decimal
  price?: Decimal
  /** Unidades de `currency` por 1 EUR. Se ignora si la divisa es EUR. */
  fxRate?: Decimal
  /** Comisiones y gastos, en EUR. */
  feesEur?: Decimal
  /** Lo que cobraron (compra) o ingresaron (venta), en EUR. */
  totalEur?: Decimal
}

export interface TradeResult {
  price?: Decimal
  fxRate?: Decimal
  feesEur?: Decimal
  totalEur?: Decimal
  /** Campos que se han calculado, para mostrarlos como sugerencia. */
  derived: { price?: boolean; fxRate?: boolean; feesEur?: boolean; totalEur?: boolean }
  /** Coste (compra) o ingreso (venta) real por título en EUR, comisiones incluidas. */
  perShareEur?: Decimal
  /** El total no cuadra con cantidad × precio ± comisiones: diferencia en EUR. */
  mismatchEur?: Decimal
  /** El total sale incoherente con el precio (comisiones negativas). */
  inconsistent?: boolean
}

const ZERO = new Decimal(0)
const round = (v: Decimal, dp: number) => v.toDecimalPlaces(dp, Decimal.ROUND_HALF_EVEN)

export function completeTrade(input: TradeInput): TradeResult {
  const { type, currency, quantity: qty } = input
  const s = type === 'compra' ? 1 : -1
  const res: TradeResult = { derived: {} }
  let { price, feesEur, totalEur } = input
  let fx = currency === 'EUR' ? new Decimal(1) : input.fxRate
  if (currency === 'EUR' || input.fxRate) res.fxRate = fx
  Object.assign(res, { price, feesEur, totalEur })

  if (!qty || qty.lte(0)) return res

  // Sin tipo de cambio: si se conoce el total, sale el cambio efectivo
  // (el que explica el total, con las comisiones que se hayan puesto).
  if (!fx) {
    if (price && totalEur) {
      const grossEur = totalEur.minus(feesEur?.mul(s) ?? ZERO)
      if (grossEur.gt(0)) {
        fx = round(qty.mul(price).div(grossEur), 6)
        res.fxRate = fx
        res.derived.fxRate = true
      }
    }
    if (!fx) return res
  }

  // Sin precio: sale del total y las comisiones.
  if (!price && totalEur) {
    const grossEur = totalEur.minus(feesEur?.mul(s) ?? ZERO)
    if (grossEur.gt(0)) {
      price = round(grossEur.mul(fx).div(qty), 6)
      res.price = price
      res.derived.price = true
    }
  }
  if (!price) return res

  const grossEur = qty.mul(price).div(fx)

  // Con el total y sin comisiones: las comisiones son la diferencia.
  if (totalEur && !feesEur) {
    const fees = round(totalEur.minus(grossEur).mul(s), 2)
    if (fees.isNeg()) {
      // Cobran menos de lo que vale (o ingresan más): no es posible con comisiones.
      res.inconsistent = true
      res.mismatchEur = fees.neg()
    } else {
      feesEur = fees
      res.feesEur = fees
      res.derived.feesEur = true
    }
  }

  // Sin total: se calcula con las comisiones que haya (o ninguna).
  if (!totalEur) {
    totalEur = round(grossEur.plus((feesEur ?? ZERO).mul(s)), 2)
    res.totalEur = totalEur
    res.derived.totalEur = true
  } else if (feesEur && !res.derived.feesEur && !res.derived.fxRate && !res.derived.price) {
    // Todo puesto a mano: avisa si no cuadra (más de un céntimo).
    const diff = totalEur.minus(grossEur.plus(feesEur.mul(s)))
    if (diff.abs().gt(0.01)) res.mismatchEur = diff
  }

  res.perShareEur = totalEur.div(qty)
  return res
}
