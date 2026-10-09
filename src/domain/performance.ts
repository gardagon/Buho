import { Decimal, d } from './numbers'
import { buyCostEur, sellProceedsEur, toEur } from './portfolio'
import type { Movement, PricePoint, QuoteDay, FxRates } from './types'
import { priceHistory } from './valuation'

/** Un precio en EUR en una fecha, y de dónde sale. */
export interface DatedPrice {
  date: string
  eur: Decimal
  source: 'manual' | 'mercado' | 'movimiento'
}

/**
 * Todos los precios conocidos de un activo, en EUR y por fecha: los que puso la
 * persona, las cotizaciones guardadas y, como último recurso, el precio de sus
 * propias compras y ventas. Si un día tiene varios, gana el manual, luego el de mercado.
 */
export function knownPrices(movements: Movement[], manual: PricePoint[], market: QuoteDay[], fx?: FxRates): DatedPrice[] {
  const byDate = new Map<string, DatedPrice>()
  for (const m of movements) {
    if (m.deleted || (m.type !== 'compra' && m.type !== 'venta') || !m.price) continue
    byDate.set(m.date, { date: m.date, eur: toEur(d(m.price), m.fxRate), source: 'movimiento' })
  }
  for (const h of priceHistory([], market, fx)) byDate.set(h.date, { date: h.date, eur: h.eur, source: 'mercado' })
  for (const h of priceHistory(manual, [], fx)) byDate.set(h.date, { date: h.date, eur: h.eur, source: 'manual' })
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** El último precio conocido en esa fecha o antes. */
export function priceOn(prices: DatedPrice[], date: string): DatedPrice | undefined {
  let found: DatedPrice | undefined
  for (const p of prices) {
    if (p.date > date) break
    found = p
  }
  return found
}

export const PERIODS = [
  { id: '1s', label: '1 semana', days: 7 },
  { id: '1m', label: '1 mes', months: 1 },
  { id: '1a', label: '1 año', months: 12 },
  { id: '2a', label: '2 años', months: 24 },
  { id: '5a', label: '5 años', months: 60 },
] as const

/** Resta días o meses a una fecha AAAA-MM-DD. Si el día no existe en el mes de destino, se queda en el último. */
export function shiftDate(date: string, by: { days?: number; months?: number }): string {
  const [y, m, day] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, day, 12))
  if (by.months) {
    const target = new Date(Date.UTC(y, m - 1 - by.months, 1, 12))
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate()
    t.setTime(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last), 12))
  }
  if (by.days) t.setUTCDate(t.getUTCDate() - by.days)
  return t.toISOString().slice(0, 10)
}

export interface PeriodResult {
  id: string
  label: string
  /** Fecha de inicio del periodo. */
  date: string
  /** Títulos que se tenían ese día. */
  sharesThen: Decimal
  /** Último precio conocido ese día o antes. */
  priceThen?: DatedPrice
  /** Lo que valían esos títulos ese día, en EUR. */
  valueThenEur?: Decimal
  /** Compras, ventas y rendimientos cobrados desde entonces, en EUR. */
  boughtEur: Decimal
  soldEur: Decimal
  incomeEur: Decimal
  /** Beneficio del periodo: valor ahora − valor entonces − compras + ventas + rendimientos. */
  profitEur?: Decimal
  /** Beneficio sobre el capital de partida más lo comprado en el periodo. */
  pct?: Decimal
  status: 'ok' | 'sin-posicion' | 'sin-precio' | 'sin-precio-actual'
}

/**
 * Cuánto se ha ganado (o perdido) con un valor en cada periodo, teniendo en
 * cuenta los títulos que había en cartera al empezar y lo que se compró y
 * vendió después. No es lo que tributa, sino lo que de verdad ha rendido el
 * dinero invertido en ese tiempo, sin agrupar ventas.
 */
export function periodPerformance(args: {
  movements: Movement[]
  /** Fecha de hoy, AAAA-MM-DD. */
  today: string
  /** Valor actual de los títulos que se tienen, en EUR. */
  valueNowEur?: Decimal
  prices: DatedPrice[]
}): PeriodResult[] {
  const moves = args.movements.filter((m) => !m.deleted)
  return PERIODS.map((p) => {
    const date = shiftDate(args.today, p)
    let shares = new Decimal(0)
    let bought = new Decimal(0)
    let sold = new Decimal(0)
    let income = new Decimal(0)
    for (const m of moves) {
      if (m.date <= date) {
        if (m.type === 'compra') shares = shares.plus(d(m.quantity))
        else if (m.type === 'venta') shares = shares.minus(d(m.quantity))
      } else if (m.date <= args.today) {
        if (m.type === 'compra') bought = bought.plus(buyCostEur(m))
        else if (m.type === 'venta') sold = sold.plus(sellProceedsEur(m))
        else income = income.plus(toEur(d(m.amount).minus(d(m.withholding)).minus(d(m.fees)), m.fxRate))
      }
    }
    const base: PeriodResult = {
      id: p.id,
      label: p.label,
      date,
      sharesThen: shares,
      boughtEur: bought,
      soldEur: sold,
      incomeEur: income,
      status: 'ok',
    }
    if (shares.lte(0) && bought.isZero()) return { ...base, status: 'sin-posicion' }

    let valueThen = new Decimal(0)
    if (shares.gt(0)) {
      const priceThen = priceOn(args.prices, date)
      if (!priceThen) return { ...base, status: 'sin-precio' }
      valueThen = shares.mul(priceThen.eur)
      base.priceThen = priceThen
      base.valueThenEur = valueThen
    } else {
      base.valueThenEur = valueThen
    }
    if (!args.valueNowEur) return { ...base, status: 'sin-precio-actual' }

    const profit = args.valueNowEur.minus(valueThen).minus(bought).plus(sold).plus(income)
    const capital = valueThen.plus(bought)
    return { ...base, profitEur: profit, pct: capital.gt(0) ? profit.div(capital) : undefined }
  })
}
