import { Decimal, d } from './numbers'
import type { Movement } from './types'

/**
 * Importes de un dividendo o un cupón, todos en EUR.
 *
 * - Bruto y comisiones están en la divisa del movimiento y se pasan a EUR con su tipo de cambio.
 * - Las retenciones pueden venir separadas (origen y España), cada una en su divisa: en EUR o en la
 *   divisa del movimiento. Si no, se usa la retención total de siempre (`withholding`), sin clasificar.
 * - Si se conoce lo que el bróker ingresó (`netEur`), ese es el neto cobrado.
 */
export interface IncomeBreakdown {
  grossEur: Decimal
  /** Retención en el país de origen (doble imposición internacional). */
  originEur: Decimal
  /** Retención en España (a cuenta del IRPF). */
  destEur: Decimal
  /** Retención total sin separar en origen y destino (movimientos anteriores a la separación). */
  unclassifiedEur: Decimal
  withholdingEur: Decimal
  feesEur: Decimal
  netEur: Decimal
  /** El neto puesto a mano no cuadra con bruto − retenciones − comisiones: diferencia en EUR. */
  mismatchEur?: Decimal
}

const ZERO = new Decimal(0)

function eur(amount: Decimal, currency: string | undefined, m: Movement): Decimal {
  if (currency === 'EUR') return amount
  const fx = d(m.fxRate || 1)
  return fx.lte(0) ? amount : amount.div(fx)
}

export function incomeBreakdown(m: Movement): IncomeBreakdown {
  const grossEur = eur(d(m.amount ?? '0'), m.currency, m)
  const feesEur = eur(d(m.fees || '0'), m.currency, m)
  const split = m.withholdingOrigin !== undefined || m.withholdingDest !== undefined
  const originEur = split ? eur(d(m.withholdingOrigin ?? '0'), m.withholdingOriginCurrency ?? m.currency, m) : ZERO
  const destEur = split ? eur(d(m.withholdingDest ?? '0'), m.withholdingDestCurrency ?? m.currency, m) : ZERO
  let unclassifiedEur = split ? ZERO : eur(d(m.withholding || '0'), m.currency, m)

  const computedNet = grossEur.minus(originEur).minus(destEur).minus(unclassifiedEur).minus(feesEur)
  let netEur = computedNet
  let mismatchEur: Decimal | undefined
  if (m.netEur) {
    netEur = d(m.netEur)
    if (originEur.plus(destEur).plus(unclassifiedEur).isZero()) {
      // Sin retenciones puestas: lo que falta entre el bruto y el neto (menos comisiones) es retención.
      const withheld = grossEur.minus(feesEur).minus(netEur)
      if (withheld.gt(0)) unclassifiedEur = withheld
    } else if (netEur.minus(computedNet).abs().gt(0.01)) {
      mismatchEur = netEur.minus(computedNet)
    }
  }
  const withholdingEur = originEur.plus(destEur).plus(unclassifiedEur)
  return { grossEur, originEur, destEur, unclassifiedEur, withholdingEur, feesEur, netEur, mismatchEur }
}

/**
 * Cambio efectivo de un dividendo en divisa: el que hace que bruto, retenciones y comisiones cuadren con el neto
 * que el bróker ingresó de verdad (cada bróker aplica su cambio, y rara vez es el del BCE del día).
 *
 * neto = (bruto − comisiones − retenciones en la divisa del dividendo) ÷ cambio − retenciones en euros
 * ⇒ cambio = (bruto − comisiones − retenciones en la divisa) ÷ (neto + retenciones en euros)
 *
 * Devuelve undefined si no hay solución (el denominador o el numerador no son positivos).
 */
export function impliedIncomeFx(i: {
  amount: Decimal
  fees: Decimal
  currency: string
  netEur: Decimal
  withholdings: { amount: Decimal; currency: string }[]
}): Decimal | undefined {
  if (i.currency === 'EUR') return undefined
  let inCurrency = ZERO
  let inEur = ZERO
  for (const w of i.withholdings) {
    if (w.currency === 'EUR') inEur = inEur.plus(w.amount)
    else inCurrency = inCurrency.plus(w.amount)
  }
  const numerator = i.amount.minus(i.fees).minus(inCurrency)
  const denominator = i.netEur.plus(inEur)
  if (numerator.lte(0) || denominator.lte(0)) return undefined
  return numerator.div(denominator).toDecimalPlaces(6)
}
