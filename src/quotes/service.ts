import { db, getMeta, setMeta } from '../data/db'
import { QUOTE_META, saveFxRates, saveQuotes } from '../data/repo'
import { computePortfolio } from '../domain/portfolio'
import type { FxRates } from '../domain/types'
import { fetchFxRates } from './fx'
import { createFinnhubProvider } from './finnhub'
import type { Fetcher } from './types'

export interface RefreshReport {
  /** Cuántas cotizaciones se actualizaron. */
  updated: number
  /** Activos que no se pudieron cotizar y por qué. */
  failed: { assetName: string; message: string }[]
  /** Hay clave de proveedor guardada. */
  usedProvider: boolean
  fxError?: string
}

/**
 * Actualiza cotizaciones y tipos de cambio. Se piden los activos en cartera y
 * los marcados para seguimiento. Sin clave de proveedor solo se actualizan los
 * tipos de cambio: los precios manuales siguen valiendo.
 */
export async function refreshQuotes(fetcher?: Fetcher): Promise<RefreshReport> {
  const [allAssets, movements, apiKey] = await Promise.all([
    db.assets.toArray(),
    db.movements.toArray(),
    getMeta<string>(QUOTE_META.finnhubKey),
  ])
  const assets = allAssets.filter((a) => !a.deleted)
  const held = new Set(computePortfolio(assets, movements.filter((m) => !m.deleted)).positions.map((p) => p.asset.id))
  const tracked = assets.filter((a) => held.has(a.id) || a.watched)
  const report: RefreshReport = { updated: 0, failed: [], usedProvider: false }

  if (apiKey) {
    const provider = createFinnhubProvider(apiKey, fetcher)
    const result = await provider.getQuotes(tracked.filter((a) => provider.supports(a)))
    report.usedProvider = true
    await saveQuotes([...result.quotes.values()])
    report.updated = result.quotes.size
    for (const [id, message] of result.errors) {
      report.failed.push({ assetName: assets.find((a) => a.id === id)?.name ?? id, message })
    }
  }

  // Divisas de lo que se sigue y de lo que puede traer una cotización.
  try {
    const fx: FxRates = await fetchFxRates(
      tracked.map((a) => a.currency),
      fetcher,
    )
    if (Object.keys(fx.rates).length > 0) await saveFxRates(fx)
  } catch (e) {
    report.fxError = e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'Sin conexión para pedir los tipos de cambio.'
  }

  // Si no se consiguió nada, no se marca como actualizado.
  if (!report.fxError || report.updated > 0) await setMeta(QUOTE_META.refreshedAt, new Date().toISOString())
  return report
}
