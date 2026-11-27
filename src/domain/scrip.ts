import { Decimal, d } from './numbers'
import type { Lot } from './portfolio'
import type { Movement, RightsBuyer } from './types'

/**
 * Dividendo flexible (scrip): la empresa reparte un derecho por acción y cada uno elige entre venderle los derechos a
 * ella a un precio fijo, venderlos en el mercado o cambiarlos por acciones nuevas (ampliación de capital liberada).
 *
 * Reglas (art. 37.1.a LIRPF, ver docs/FISCALIDAD.md):
 * - Las acciones nuevas no tributan al recibirlas. El coste de cada lote se reparte entre sus acciones y las nuevas
 *   que salen de sus derechos, y las nuevas tienen la fecha de compra de ese lote.
 * - Cada acción da un derecho. Si hay acciones de varias compras, los derechos salen primero de las más antiguas.
 * - Si no se venden todos los derechos, se entiende que los vendidos son los de las acciones compradas primero
 *   (FIFO). Las acciones nuevas salen de los derechos que quedan, que son los de las compras más recientes.
 */

export interface ScripLotShare {
  buyMovementId: string
  buyDate: string
  /** Acciones del lote justo antes del dividendo flexible. */
  quantityBefore: Decimal
  rights: Decimal
  /** Derechos de este lote vendidos (o sin usar): son los de las compras más antiguas. */
  rightsSold: Decimal
  /** Derechos de este lote cambiados por acciones nuevas. */
  rightsUsed: Decimal
  /** Parte de las acciones nuevas que va a este lote (puede ser una fracción). */
  newShares: Decimal
  unitCostEurBefore: Decimal
  unitCostEurAfter: Decimal
}

export interface ScripEvent {
  movementId: string
  assetId: string
  date: string
  rights: Decimal
  rightsSold: Decimal
  rightsUsed: Decimal
  /** Derechos que ni se venden ni se cambian por acciones (los que sobran sin apuntar). */
  rightsLeft: Decimal
  newShares: Decimal
  soldTo?: RightsBuyer
  /** Coste medio por acción de toda la posición antes y después, en EUR. */
  avgCostEurBefore: Decimal
  avgCostEurAfter: Decimal
  lots: ScripLotShare[]
}

const ZERO = new Decimal(0)

/** Importe bruto de los derechos vendidos, en la divisa del movimiento: el apuntado o derechos × precio. */
export function rightsGross(m: Movement): Decimal {
  if (m.amount && !d(m.amount).isZero()) return d(m.amount)
  return d(m.rightsSold ?? '0').mul(d(m.price ?? '0'))
}

/** Acciones nuevas que dan unos derechos con una proporción (solo enteras) y los derechos que sobran. */
export function scripSplit(rights: Decimal, ratio: Decimal): { newShares: Decimal; leftover: Decimal } {
  if (ratio.lte(0)) return { newShares: ZERO, leftover: rights }
  const newShares = rights.div(ratio).floor()
  return { newShares, leftover: rights.minus(newShares.mul(ratio)) }
}

/**
 * Aplica un dividendo flexible a los lotes vivos de un activo (en orden FIFO) y los modifica: suma a cada lote su
 * parte de las acciones nuevas y baja su coste por acción, sin tocar el coste total ni la fecha. Devuelve el reparto
 * y los avisos para la persona.
 */
export function applyScrip(m: Movement, lots: Lot[]): { event: ScripEvent; problems: string[] } {
  const problems: string[] = []
  const held = lots.reduce((s, l) => s.plus(l.quantity), ZERO)
  const costBefore = lots.reduce((s, l) => s.plus(l.quantity.mul(l.unitCostEur)), ZERO)
  const rights = m.quantity && d(m.quantity).gt(0) ? d(m.quantity) : held
  const newShares = d(m.newShares ?? '0')
  const ratio = d(m.scripRatio ?? '0')
  const rightsSold = d(m.rightsSold ?? '0')

  if (rights.gt(held)) {
    problems.push(`Apuntas ${rights.toString()} derechos pero solo tenías ${held.toString()} acciones. Revisa las compras anteriores.`)
  }

  // 1) Derechos de cada lote: uno por acción, empezando por las compras más antiguas.
  let left = Decimal.min(rights, held)
  const perLot = lots.map((lot) => {
    const r = Decimal.min(lot.quantity, left)
    left = left.minus(r)
    return r
  })
  const assigned = perLot.reduce((s, r) => s.plus(r), ZERO)

  // 2) Derechos cambiados por acciones: con la proporción, acciones nuevas × derechos por acción; sin ella, lo que
  // no se ha vendido. Lo demás (vendido o sin usar) sale de las compras más antiguas.
  const wanted = ratio.gt(0) ? newShares.mul(ratio) : newShares.gt(0) ? assigned.minus(rightsSold) : ZERO
  if (rightsSold.plus(wanted).gt(rights)) {
    problems.push(
      `Vendes ${rightsSold.toString()} derechos y cambias ${wanted.toString()} por acciones, pero solo recibiste ${rights.toString()}. ` +
        'Revisa los derechos vendidos o las acciones nuevas (comprar derechos para completar una acción aún no está contemplado).',
    )
  }
  const used = Decimal.max(Decimal.min(wanted, assigned.minus(rightsSold)), ZERO)
  const rightsLeft = Decimal.max(rights.minus(rightsSold).minus(wanted), ZERO)

  let notUsed = assigned.minus(used) // los más antiguos
  const shares: ScripLotShare[] = []
  lots.forEach((lot, i) => {
    const r = perLot[i]
    if (r.lte(0)) return
    const sold = Decimal.min(r, notUsed)
    notUsed = notUsed.minus(sold)
    const u = r.minus(sold)
    // Se multiplica antes de dividir para no arrastrar redondeos.
    const received = used.gt(0) ? newShares.mul(u).div(used) : ZERO
    const before = lot.quantity
    const unitBefore = lot.unitCostEur
    if (received.gt(0)) {
      const after = before.plus(received)
      lot.unitCostEur = lot.unitCostEur.mul(before).div(after)
      lot.unitCost = lot.unitCost.mul(before).div(after)
      lot.quantity = after
    }
    shares.push({
      buyMovementId: lot.movementId,
      buyDate: lot.date,
      quantityBefore: before,
      rights: r,
      rightsSold: sold,
      rightsUsed: u,
      newShares: received,
      unitCostEurBefore: unitBefore,
      unitCostEurAfter: lot.unitCostEur,
    })
  })

  if (newShares.gt(0) && used.lte(0)) {
    problems.push('Recibes acciones nuevas pero no quedan derechos para cambiarlas. Revisa los derechos vendidos.')
  }
  const heldAfter = lots.reduce((s, l) => s.plus(l.quantity), ZERO)
  return {
    event: {
      movementId: m.id,
      assetId: m.assetId,
      date: m.date,
      rights,
      rightsSold,
      rightsUsed: used,
      rightsLeft,
      newShares: used.gt(0) ? newShares : ZERO,
      soldTo: rightsSold.gt(0) ? (m.rightsSoldTo ?? 'emisor') : undefined,
      avgCostEurBefore: held.gt(0) ? costBefore.div(held) : ZERO,
      avgCostEurAfter: heldAfter.gt(0) ? costBefore.div(heldAfter) : ZERO,
      lots: shares,
    },
    problems,
  }
}
