import { db, getMeta, setMeta } from '../data/db'
import { QUOTE_META, saveAsset, saveFxRates, saveQuotes } from '../data/repo'
import { computePortfolio } from '../domain/portfolio'
import type { FxRates, Quote } from '../domain/types'
import { fetchFxRates } from './fx'
import { createFinnhubProvider } from './finnhub'
import type { Fetcher, PriceProvider, SearchHit } from './types'
import { createYahooProvider, normalizeProxyUrl } from './yahoo'

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
  const [allAssets, movements, apiKey, proxy] = await Promise.all([
    db.assets.toArray(),
    db.movements.toArray(),
    getMeta<string>(QUOTE_META.finnhubKey),
    getMeta<string>(QUOTE_META.yahooProxy),
  ])
  const assets = allAssets.filter((a) => !a.deleted)
  const held = new Set(computePortfolio(assets, movements.filter((m) => !m.deleted)).positions.map((p) => p.asset.id))
  const tracked = assets.filter((a) => held.has(a.id) || a.watched)
  const report: RefreshReport = { updated: 0, failed: [], usedProvider: false }

  // Finnhub primero (oficial); lo que no pueda cotizar pasa a Yahoo, si está configurado.
  const providers: PriceProvider[] = []
  if (apiKey) providers.push(createFinnhubProvider(apiKey, fetcher))
  const proxyUrl = proxy ? normalizeProxyUrl(proxy) : null
  if (proxyUrl) providers.push(createYahooProvider(proxyUrl, fetcher))

  const errors = new Map<string, string>()
  let pending = tracked
  for (const provider of providers) {
    const result = await provider.getQuotes(pending.filter((a) => provider.supports(a)))
    report.usedProvider = true
    await saveQuotes([...result.quotes.values()])
    report.updated += result.quotes.size
    for (const id of result.quotes.keys()) errors.delete(id)
    // Si un valor falla en dos proveedores, se cuenta el último fallo, que es el más completo.
    for (const [id, message] of result.errors) errors.set(id, message)
    pending = pending.filter((a) => !result.quotes.has(a.id))
  }
  for (const [id, message] of errors) {
    report.failed.push({ assetName: assets.find((a) => a.id === id)?.name ?? id, message })
  }

  // Divisas de lo que se sigue y de lo que puede traer una cotización.
  try {
    const fx: FxRates = await fetchFxRates(
      // USD siempre, para poder ver cualquier precio en euros y en dólares.
      [...tracked.map((a) => a.currency), ...tracked.map((a) => a.manualPriceCurrency ?? a.currency), 'USD'],
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

export interface SearchResult {
  hit: SearchHit
  /** Cotización actual, si el plan del proveedor la da para este valor. */
  quote?: Quote
}

/**
 * Busca valores por nombre o ticker y pide la cotización de cada resultado.
 * Un resultado sin cotización (p. ej. una bolsa que el plan gratuito no cubre)
 * se devuelve igualmente: se puede seguir y ponerle precio a mano.
 */
export async function searchSecurities(query: string, fetcher?: Fetcher): Promise<SearchResult[]> {
  const [apiKey, proxy] = await Promise.all([getMeta<string>(QUOTE_META.finnhubKey), getMeta<string>(QUOTE_META.yahooProxy)])
  // Yahoo (si está configurado) busca en más mercados y da la divisa real; si no, Finnhub.
  const proxyUrl = proxy ? normalizeProxyUrl(proxy) : null
  const provider = proxyUrl ? createYahooProvider(proxyUrl, fetcher) : apiKey ? createFinnhubProvider(apiKey, fetcher) : null
  if (!provider?.search) {
    throw new Error('Para buscar valores hace falta tu clave gratuita de Finnhub o el proxy de Yahoo. Añádelos en Ajustes.')
  }
  const hits = await provider.search(query)
  // Cotizamos con un activo provisional: el id es el propio símbolo.
  const probes = hits.map((h) => ({
    id: h.symbol,
    name: h.name,
    type: h.type,
    currency: h.currency,
    ticker: h.symbol,
    createdAt: '',
    updatedAt: '',
  }))
  const { quotes } = await provider.getQuotes(probes)
  // La divisa de la cotización es la real; la del resultado era solo una estimación.
  return hits.map((hit) => {
    const quote = quotes.get(hit.symbol)
    return { hit: quote ? { ...hit, currency: quote.currency } : hit, quote }
  })
}

/**
 * Empieza a seguir un valor encontrado en la búsqueda. Si ya hay un activo con
 * ese ticker, lo reutiliza en vez de duplicarlo. Devuelve el id del activo.
 */
export async function followSecurity({ hit, quote }: SearchResult): Promise<string> {
  const existing = (await db.assets.toArray()).find((a) => !a.deleted && a.ticker?.toUpperCase() === hit.symbol.toUpperCase())
  const id = existing
    ? await saveAsset({ ...stripRecord(existing), watched: true }, existing.id)
    : await saveAsset({ name: hit.name, type: hit.type, currency: hit.currency, ticker: hit.symbol, watched: true })
  if (quote) await saveQuotes([{ ...quote, assetId: id }])
  return id
}

function stripRecord<T extends { id: string; createdAt: string; updatedAt: string; deleted?: boolean }>(a: T) {
  const { id: _id, createdAt: _c, updatedAt: _u, deleted: _d, ...rest } = a
  return rest
}
