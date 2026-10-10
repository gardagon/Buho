import { db, getMeta, setMeta } from '../data/db'
import { QUOTE_META, saveAsset, saveFxRates, saveQuoteDays, saveQuotes } from '../data/repo'
import { computePortfolio } from '../domain/portfolio'
import type { Asset, FxRates, Movement, Quote, QuoteDay } from '../domain/types'
import { fetchFxRates } from './fx'
import { createFinnhubProvider } from './finnhub'
import type { Fetcher, HistoryRange, PriceProvider, SearchHit } from './types'
import { createYahooProvider, normalizeProxyUrl } from './yahoo'

export interface RefreshReport {
  /** Cuántas cotizaciones se actualizaron. */
  updated: number
  /** Activos que no se pudieron cotizar y por qué. */
  failed: { assetName: string; message: string }[]
  /** Hay clave de proveedor guardada. */
  usedProvider: boolean
  fxError?: string
  /** Días de histórico descargados en esta actualización. */
  historyDays: number
  /** Cuánto tardó cada paso, para saber dónde se va el tiempo. */
  timings?: RefreshTimings
}

export interface RefreshTimings {
  totalMs: number
  finnhubMs?: number
  yahooMs?: number
  fxMs?: number
}

/**
 * Actualiza cotizaciones y tipos de cambio. Se piden los activos en cartera y
 * los marcados para seguimiento. Sin clave de proveedor solo se actualizan los
 * tipos de cambio: los precios manuales siguen valiendo.
 */
export async function refreshQuotes(fetcher?: Fetcher, opts: { history?: boolean } = {}): Promise<RefreshReport> {
  const [allAssets, movements, apiKey, proxy] = await Promise.all([
    db.assets.toArray(),
    db.movements.toArray(),
    getMeta<string>(QUOTE_META.finnhubKey),
    getMeta<string>(QUOTE_META.yahooProxy),
  ])
  const assets = allAssets.filter((a) => !a.deleted)
  const held = new Set(computePortfolio(assets, movements.filter((m) => !m.deleted)).positions.map((p) => p.asset.id))
  const tracked = assets.filter((a) => held.has(a.id) || a.watched)
  const report: RefreshReport = { updated: 0, failed: [], usedProvider: false, historyDays: 0 }

  // Cada valor se pide primero a la fuente que le dio precio la última vez, y solo si esa no
  // devuelve datos se prueba con la otra. Sin historial, Finnhub solo para valores de EE. UU.
  // (su plan gratuito no cubre bolsas con sufijo: SAN.MC, SAP.DE…); el resto, Yahoo.
  // Si Finnhub no responde, no se le vuelve a preguntar durante un rato.
  const [sources, downUntil] = await Promise.all([
    getMeta<Record<string, string>>(QUOTE_META.sources).then((v) => v ?? {}),
    getMeta<string>(QUOTE_META.finnhubDownUntil),
  ])
  const finnhubDown = !!downUntil && downUntil > new Date().toISOString()
  const proxyUrl = proxy ? normalizeProxyUrl(proxy) : null
  const providers = new Map<string, PriceProvider>()
  if (apiKey && !finnhubDown) providers.set('finnhub', createFinnhubProvider(apiKey, fetcher))
  if (proxyUrl) providers.set('yahoo', createYahooProvider(proxyUrl, fetcher))

  const started = performance.now()
  const timings: RefreshTimings = { totalMs: 0 }
  const since = (t: number) => Math.round(performance.now() - t)

  const fxPromise = (async () => {
    const t = performance.now()
    try {
      const fx: FxRates = await fetchFxRates(
        // USD siempre, para poder ver cualquier precio en euros y en dólares.
        [...tracked.map((a) => a.currency), ...tracked.map((a) => a.manualPriceCurrency ?? a.currency), 'USD'],
        fetcher,
      )
      if (Object.keys(fx.rates).length > 0) await saveFxRates(fx)
      return undefined
    } catch (e) {
      return e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'Sin conexión para pedir los tipos de cambio.'
    } finally {
      timings.fxMs = since(t)
    }
  })()

  const candidates = (a: Asset) => [...providers.values()].filter((p) => p.supports(a))
  const primaryOf = (a: Asset): string | undefined => {
    const c = candidates(a)
    const remembered = sources[a.id]
    if (remembered && c.some((p) => p.id === remembered)) return remembered
    if (c.some((p) => p.id === 'finnhub') && !a.ticker?.includes('.')) return 'finnhub'
    return (c.find((p) => p.id === 'yahoo') ?? c[0])?.id
  }

  const got = new Map<string, string>() // activo → proveedor que le dio precio
  const lastError = new Map<string, string>()
  const offlineWith = new Set<string>()
  /** Pide a cada proveedor, a la vez, los activos que le tocan, y guarda lo que llega. */
  async function wave(plan: Map<string, Asset[]>) {
    await Promise.all(
      [...plan].map(async ([id, list]) => {
        const provider = providers.get(id)!
        report.usedProvider = true
        const t = performance.now()
        const result = await provider.getQuotes(list)
        timings[id === 'finnhub' ? 'finnhubMs' : 'yahooMs'] = (timings[id === 'finnhub' ? 'finnhubMs' : 'yahooMs'] ?? 0) + since(t)
        const mine = [...result.quotes.values()]
        for (const q of mine) got.set(q.assetId, id)
        await saveQuotes(mine)
        await saveTodayPrices(mine)
        for (const [aid, message] of result.errors) {
          lastError.set(aid, message)
          if (/Sin conexión/.test(message)) offlineWith.add(`${aid}:${id}`)
        }
      }),
    )
  }
  const group = (pairs: [string, Asset][]) => {
    const plan = new Map<string, Asset[]>()
    for (const [pid, a] of pairs) plan.set(pid, [...(plan.get(pid) ?? []), a])
    return plan
  }

  const first = new Map<string, string>() // activo → proveedor de la primera ronda
  const wave1: [string, Asset][] = []
  for (const a of tracked) {
    const pid = primaryOf(a)
    if (pid) {
      first.set(a.id, pid)
      wave1.push([pid, a])
    }
  }
  await wave(group(wave1))
  // Lo que su fuente habitual no ha dado se pide a la otra.
  const wave2: [string, Asset][] = []
  for (const a of tracked) {
    if (got.has(a.id) || !first.has(a.id)) continue
    for (const p of candidates(a)) if (p.id !== first.get(a.id)) wave2.push([p.id, a])
  }
  await wave(group(wave2))
  report.updated = got.size

  // Recordar qué fuente funciona para cada valor, salvo que la habitual solo haya fallado por falta de red.
  const next = { ...sources }
  for (const [aid, pid] of got) {
    if (!next[aid] || (next[aid] !== pid && !offlineWith.has(`${aid}:${next[aid]}`))) next[aid] = pid
  }
  await setMeta(QUOTE_META.sources, next)
  // Si Finnhub no ha podido ni conectar con ninguno de sus valores, se le deja descansar un rato.
  const finnhubTried = [...first].filter(([, pid]) => pid === 'finnhub').map(([aid]) => aid)
  if (finnhubTried.length > 0 && finnhubTried.every((aid) => offlineWith.has(`${aid}:finnhub`))) {
    await setMeta(QUOTE_META.finnhubDownUntil, new Date(Date.now() + FINNHUB_REST_MS).toISOString())
  } else if (finnhubTried.some((aid) => got.get(aid) === 'finnhub')) {
    await setMeta(QUOTE_META.finnhubDownUntil, '')
  }

  for (const a of tracked) {
    if (got.has(a.id)) continue
    const message = lastError.get(a.id)
    if (message) report.failed.push({ assetName: a.name, message })
  }

  // Histórico de lo que falte (solo con Yahoo). Un fallo aquí no estropea la actualización.
  // La app lo pide aparte (`opts.history: false`) para no hacer esperar a las cotizaciones.
  if (proxyUrl && opts.history !== false) {
    try {
      const h = await refreshHistory(createYahooProvider(proxyUrl, fetcher), tracked, movements.filter((m) => !m.deleted))
      report.historyDays = h.days
      for (const e of h.errors) report.failed.push({ assetName: e.assetName, message: `Histórico: ${e.message}` })
    } catch {
      /* se reintenta en la siguiente actualización */
    }
  }

  const fxError = await fxPromise
  if (fxError) report.fxError = fxError
  timings.totalMs = since(started)
  report.timings = timings
  await setMeta(QUOTE_META.lastRun, { at: new Date().toISOString(), updated: report.updated, failed: report.failed.length, ...timings })

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

/** Tras no poder conectar con Finnhub, cuánto se espera antes de volver a preguntarle. */
const FINNHUB_REST_MS = 30 * 60_000
const DAY_MS = 86_400_000
const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((new Date(to + 'T12:00:00Z').getTime() - new Date(from + 'T12:00:00Z').getTime()) / DAY_MS)

/** El periodo más corto de Yahoo que cubre esos días. */
export function rangeForDays(days: number): HistoryRange {
  if (days <= 31) return '1mo'
  if (days <= 92) return '3mo'
  if (days <= 183) return '6mo'
  if (days <= 366) return '1y'
  if (days <= 731) return '2y'
  if (days <= 1830) return '5y'
  if (days <= 3660) return '10y'
  return 'max'
}

/**
 * Guarda el precio de hoy en el histórico de cada valor, sin pedir nada más: así
 * el histórico se va completando con cada actualización. Es el último precio
 * visto; si luego se baja el histórico, el cierre real lo sustituye (conservando
 * máximo y mínimo). Fines de semana no se anota: el mercado no abre.
 */
export async function saveTodayPrices(quotes: Quote[]) {
  const days: QuoteDay[] = []
  for (const q of quotes) {
    const date = localDate(new Date(q.at))
    const dow = new Date(date + 'T12:00:00Z').getUTCDay()
    if (dow === 0 || dow === 6) continue
    const prev = await db.quoteDays.get([q.assetId, date])
    days.push({ assetId: q.assetId, date, price: q.price, currency: q.currency, high: prev?.high, low: prev?.low })
  }
  if (days.length > 0) await saveQuoteDays(days)
}

interface HistoryState {
  /** Fecha más antigua que se pidió en la descarga completa. */
  from: string
  /** Último día que devolvió un histórico descargado. */
  upTo: string
}

const FIVE_YEARS = 1825
/** Días sin histórico descargado a partir de los cuales se pide un tramo corto para tapar el hueco. */
const GAP_DAYS = 4
/** Valores cuyo histórico se piden a la vez. */
const HISTORY_PARALLEL = 3

/**
 * Descarga el histórico diario de lo que se sigue. La descarga completa (5 años,
 * o desde la primera compra si es más antigua) se hace UNA sola vez por valor y
 * queda anotada, aunque Yahoo devuelva menos años (un valor joven). Después el
 * histórico se completa con el precio de cada actualización y, si la app lleva
 * varios días sin abrirse, con un tramo corto. Se intenta una vez al día por
 * activo, para no insistir con tickers que Yahoo no conoce.
 */
export async function refreshHistory(
  provider: PriceProvider,
  tracked: Asset[],
  movements: Movement[],
  today = localDate(),
): Promise<{ days: number; errors: { assetName: string; message: string }[] }> {
  const out = { days: 0, errors: [] as { assetName: string; message: string }[] }
  if (!provider.history) return out
  const tried = (await getMeta<Record<string, string>>(QUOTE_META.historyTried)) ?? {}
  const state = (await getMeta<Record<string, HistoryState>>(QUOTE_META.historyState)) ?? {}

  async function one(asset: Asset) {
    if (tried[asset.id] === today) return
    const firstMovement = movements.filter((m) => m.assetId === asset.id).map((m) => m.date).sort()[0]
    // Desde cuándo hace falta tener datos: 5 años, o la primera compra si es anterior.
    const needFrom = firstMovement && daysBetween(firstMovement, today) > FIVE_YEARS ? firstMovement : localDate(new Date(Date.now() - FIVE_YEARS * DAY_MS))
    let st = state[asset.id]
    if (!st) {
      // Datos de versiones anteriores: si ya hay mucho guardado, no se vuelve a bajar todo.
      const stored = await db.quoteDays.where('assetId').equals(asset.id).sortBy('date')
      if (stored.length >= 200) st = state[asset.id] = { from: needFrom, upTo: stored[stored.length - 1].date }
    }

    let range: HistoryRange | null = null
    // Completa solo la primera vez, o si ahora hace falta algo más antiguo (una compra antigua añadida después).
    if (!st || daysBetween(needFrom, st.from) > 30) range = rangeForDays(daysBetween(needFrom, today))
    else if (daysBetween(st.upTo, today) > GAP_DAYS) range = rangeForDays(daysBetween(st.upTo, today) + 5)
    if (!range) return

    try {
      const days = await provider.history!(asset, range)
      await saveQuoteDays(days)
      out.days += days.length
      tried[asset.id] = today
      const upTo = days.map((d) => d.date).sort().pop() ?? st?.upTo ?? today
      const full = !st || range === rangeForDays(daysBetween(needFrom, today))
      state[asset.id] = { from: full ? needFrom : st!.from, upTo }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error'
      out.errors.push({ assetName: asset.name, message })
      // Sin conexión se reintenta enseguida; un ticker desconocido, mañana.
      if (!/Sin conexión/.test(message)) tried[asset.id] = today
    }
  }

  // Unos pocos a la vez: un valor lento no retrasa a los demás.
  const queue = tracked.filter((a) => a.ticker)
  await Promise.all(
    Array.from({ length: Math.min(HISTORY_PARALLEL, queue.length) }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) await one(a)
    }),
  )
  await setMeta(QUOTE_META.historyTried, tried)
  await setMeta(QUOTE_META.historyState, state)
  return out
}

/** Pide el histórico que falte de lo que se sigue, sin esperar a una actualización de precios. */
export async function refreshHistoryNow(fetcher?: Fetcher) {
  const proxy = await getMeta<string>(QUOTE_META.yahooProxy)
  const proxyUrl = proxy ? normalizeProxyUrl(proxy) : null
  if (!proxyUrl) return { days: 0, errors: [] as { assetName: string; message: string }[] }
  const [allAssets, movements] = await Promise.all([db.assets.toArray(), db.movements.toArray()])
  const assets = allAssets.filter((a) => !a.deleted)
  const live = movements.filter((m) => !m.deleted)
  const held = new Set(computePortfolio(assets, live).positions.map((p) => p.asset.id))
  const t = performance.now()
  const h = await refreshHistory(createYahooProvider(proxyUrl, fetcher), assets.filter((a) => held.has(a.id) || a.watched), live)
  await setMeta(QUOTE_META.lastHistoryRun, { at: new Date().toISOString(), days: h.days, failed: h.errors.length, ms: Math.round(performance.now() - t) })
  return h
}
