import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../data/db'
import { checkTradePrice, type PriceCheck } from '../domain/checks'
import { computePortfolio } from '../domain/portfolio'
import type { Asset, Movement } from '../domain/types'

const EMPTY_A: Asset[] = []
const EMPTY_M: Movement[] = []

export function useAssets(): Asset[] {
  return (
    useLiveQuery(async () => {
      const all = await db.assets.toArray()
      return all.filter((a) => !a.deleted).sort((a, b) => a.name.localeCompare(b.name, 'es'))
    }) ?? EMPTY_A
  )
}

export function useMovements(): Movement[] {
  return (
    useLiveQuery(async () => {
      const all = await db.movements.toArray()
      return all.filter((m) => !m.deleted)
    }) ?? EMPTY_M
  )
}

export function usePortfolio() {
  const assets = useAssets()
  const movements = useMovements()
  const portfolio = useMemo(() => computePortfolio(assets, movements), [assets, movements])
  return { assets, movements, portfolio }
}

export function useLoaded(): boolean {
  return useLiveQuery(async () => true) ?? false
}

const NO_CHECKS = new Map<string, PriceCheck>()

/**
 * Movimientos de compra o venta cuyo precio no cuadra con lo que cotizó ese día
 * (según el histórico descargado). Solo devuelve los que hay que revisar.
 */
export function useTradeChecks(movements: Movement[]): Map<string, PriceCheck> {
  return (
    useLiveQuery(async () => {
      const trades = movements.filter((m) => (m.type === 'compra' || m.type === 'venta') && m.price)
      const days = await db.quoteDays.bulkGet(trades.map((m) => [m.assetId, m.date] as [string, string]))
      const out = new Map<string, PriceCheck>()
      trades.forEach((m, i) => {
        const c = checkTradePrice(m, days[i])
        if (c.status === 'fuera') out.set(m.id, c)
      })
      return out
    }, [movements]) ?? NO_CHECKS
  )
}
