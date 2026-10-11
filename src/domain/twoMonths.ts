import { Decimal, d } from './numbers'
import type { Portfolio } from './portfolio'
import type { Asset, Movement } from './types'

/**
 * Regla de los dos meses (art. 33.5.f y g LIRPF).
 *
 * Una pérdida por vender valores no cuenta (se difiere) si se compran valores homogéneos dentro de
 * los dos meses anteriores o posteriores a la venta: un año, si los valores no cotizan (fondos de
 * inversión). La pérdida se imputa cuando se venden esos títulos recomprados.
 *
 * Cómo se aplica aquí:
 * - Solo a las partes de la venta con pérdida (cada lote FIFO por separado).
 * - Los títulos que cuentan como recompra son los comprados en la ventana que **siguen en cartera
 *   tras esa venta** (los que salen en la propia venta no cuentan) y no respaldan ya otra pérdida.
 * - Se difiere en proporción: con 40 títulos recomprados de 100 vendidos con pérdida, se difiere el 40 %.
 * - La pérdida diferida «viaja» con los títulos recomprados: al venderlos, se recupera en esa venta.
 * - Criptomonedas: no se aplica (no son valores; sin criterio firme de la AEAT).
 */

const ZERO = new Decimal(0)

/** Meses de la ventana para un tipo de activo, o null si no se aplica la regla. */
export function windowMonths(asset: Asset): number | null {
  if (asset.type === 'cripto') return null
  return asset.type === 'fondo' ? 12 : 2
}

/** Suma meses a una fecha ISO; si el día no existe en el mes de destino, el último día de ese mes. */
export function addMonths(date: string, months: number): string {
  const [y, m, day] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, last))
  return target.toISOString().slice(0, 10)
}

export interface SaleTwoMonths {
  /** Pérdida de esta venta que no computa por haber recomprado (positivo). */
  deferredEur: Decimal
  /** Pérdida de ventas anteriores que se recupera en esta venta, por vender los títulos recomprados (positivo). */
  releasedEur: Decimal
}

/** Una venta con pérdida y su ventana de recompra. */
export interface LossWindow {
  saleMovementId: string
  asset: Asset
  saleDate: string
  /** Pérdida de la venta (positivo). */
  lossEur: Decimal
  /** Parte ya diferida por haber recomprado (positivo). */
  deferredEur: Decimal
  months: number
  /** Último día de la ventana: comprar hasta ese día (incluido) difiere la pérdida. */
  until: string
  /** Primer día en que se puede recomprar sin diferirla. */
  safeFrom: string
}

export interface TwoMonthResult {
  bySale: Map<string, SaleTwoMonths>
  windows: LossWindow[]
}

export function computeTwoMonthRule(portfolio: Portfolio, movements: Movement[]): TwoMonthResult {
  const buys = new Map<string, { id: string; date: string; qty: Decimal }[]>()
  for (const m of movements) {
    if (m.deleted || m.type !== 'compra') continue
    const list = buys.get(m.assetId) ?? []
    list.push({ id: m.id, date: m.date, qty: d(m.quantity) })
    buys.set(m.assetId, list)
  }
  for (const list of buys.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const consumed = new Map<string, Decimal>() // compra → títulos ya vendidos (hasta la venta que se procesa)
  const claimed = new Map<string, Decimal>() // compra → títulos que ya respaldan una pérdida diferida
  const claims = new Map<string, { perShare: Decimal; qty: Decimal }[]>()
  const bySale = new Map<string, SaleTwoMonths>()
  const windows: LossWindow[] = []
  const get = (m: Map<string, Decimal>, k: string) => m.get(k) ?? ZERO

  for (const sale of portfolio.sales) {
    // 1) Se venden títulos: si alguno respaldaba una pérdida diferida, se recupera ahora.
    let released = ZERO
    for (const piece of sale.matched) {
      let q = piece.quantity
      for (const c of claims.get(piece.buyMovementId) ?? []) {
        if (q.lte(0)) break
        const take = Decimal.min(q, c.qty)
        released = released.plus(take.mul(c.perShare))
        c.qty = c.qty.minus(take)
        claimed.set(piece.buyMovementId, get(claimed, piece.buyMovementId).minus(take))
        q = q.minus(take)
      }
      consumed.set(piece.buyMovementId, get(consumed, piece.buyMovementId).plus(piece.quantity))
    }

    // 2) Partes de esta venta con pérdida.
    let lossQty = ZERO
    let loss = ZERO
    for (const piece of sale.matched) {
      const proceeds = sale.proceedsEur.mul(piece.quantity).div(sale.quantity)
      const result = proceeds.minus(piece.costEur)
      if (result.lt(0)) {
        lossQty = lossQty.plus(piece.quantity)
        loss = loss.minus(result)
      }
    }

    let deferred = ZERO
    const months = windowMonths(sale.asset)
    if (months && loss.gt(0)) {
      const start = addMonths(sale.date, -months)
      const end = addMonths(sale.date, months)
      const candidates = (buys.get(sale.asset.id) ?? [])
        .filter((b) => b.date >= start && b.date <= end)
        .map((b) => ({ ...b, avail: b.qty.minus(get(consumed, b.id)).minus(get(claimed, b.id)) }))
        .filter((b) => b.avail.gt(0))
      const repurchased = candidates.reduce((s, b) => s.plus(b.avail), ZERO)
      const deferQty = Decimal.min(lossQty, repurchased)
      if (deferQty.gt(0)) {
        deferred = loss.mul(deferQty).div(lossQty)
        const perShare = deferred.div(deferQty)
        let left = deferQty
        for (const b of candidates) {
          if (left.lte(0)) break
          const take = Decimal.min(b.avail, left)
          const list = claims.get(b.id) ?? []
          list.push({ perShare, qty: take })
          claims.set(b.id, list)
          claimed.set(b.id, get(claimed, b.id).plus(take))
          left = left.minus(take)
        }
      }
      windows.push({
        saleMovementId: sale.movementId,
        asset: sale.asset,
        saleDate: sale.date,
        lossEur: loss,
        deferredEur: deferred,
        months,
        until: end,
        safeFrom: addDays(end, 1),
      })
    }
    bySale.set(sale.movementId, { deferredEur: deferred, releasedEur: released })
  }
  return { bySale, windows }
}

function addDays(date: string, n: number): string {
  const t = new Date(date + 'T12:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

export const daysUntil = (from: string, to: string) =>
  Math.round((new Date(to + 'T12:00:00Z').getTime() - new Date(from + 'T12:00:00Z').getTime()) / 86_400_000)

/** Ventas con pérdida cuya ventana de recompra sigue abierta hoy, de la que termina antes a la que termina después. */
export function openLossWindows(result: TwoMonthResult, today: string): (LossWindow & { daysLeft: number })[] {
  return result.windows
    .filter((w) => w.until >= today)
    .map((w) => ({ ...w, daysLeft: daysUntil(today, w.safeFrom) }))
    .sort((a, b) => (a.until < b.until ? -1 : 1))
}
