import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from '../data/db'
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
