import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { db, getMeta } from '../data/db'
import { QUOTE_META } from '../data/repo'
import type { FxRates, Quote } from '../domain/types'
import type { BaseCurrency } from '../domain/valuation'
import { useToast } from '../ui/Toast'
import { missingRates } from './fx'
import { refreshHistoryNow, refreshQuotes, type RefreshReport } from './service'

interface QuotesState {
  quotes: ReadonlyMap<string, Quote>
  fx?: FxRates
  refreshing: boolean
  /** Se está bajando el histórico de precios en segundo plano. */
  historyBusy: boolean
  /** Baja el histórico que falte (p. ej. al seguir un valor nuevo), sin bloquear nada. */
  loadHistory: () => Promise<void>
  /** Último intento de actualizar (ISO). */
  refreshedAt?: string
  hasKey: boolean
  /** Hay un proxy de Yahoo configurado. */
  hasYahoo: boolean
  /** Moneda en la que se enseñan los precios como principal (la otra va debajo, más pequeña). */
  baseCurrency: BaseCurrency
  /** Resultado de la última actualización de esta sesión, con los fallos. */
  lastReport?: RefreshReport
  refresh: (opts?: { silent?: boolean }) => Promise<RefreshReport | undefined>
}

const Ctx = createContext<QuotesState | null>(null)
const EMPTY = new Map<string, Quote>()
/** Al abrir la app no se vuelve a pedir si se hizo hace menos de esto. */
const AUTO_REFRESH_MS = 15 * 60 * 1000

export function summarizeReport(r: RefreshReport): string {
  const problems = r.failed.length + (r.fxError ? 1 : 0)
  if (problems === 0) return r.usedProvider ? `Cotizaciones actualizadas (${r.updated})` : 'Tipos de cambio actualizados'
  if (r.fxError && r.failed.length === 0) return r.fxError
  if (r.failed.length === 1 && !r.fxError) return `${r.failed[0].assetName}: ${r.failed[0].message}`
  return `${r.updated} actualizadas y ${problems} con problemas. Mira los detalles en Ajustes.`
}

export function QuotesProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [refreshing, setRefreshing] = useState(false)
  const [lastReport, setLastReport] = useState<RefreshReport>()
  const running = useRef(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const historyRunning = useRef(false)

  const list = useLiveQuery(() => db.quotes.toArray())
  // El envoltorio distingue «aún cargando» (undefined) de «no hay cambios guardados».
  const fxEntry = useLiveQuery(() => db.meta.get(QUOTE_META.fx).then((e) => ({ fx: e?.value as FxRates | undefined })))
  const fx = fxEntry?.fx
  const assetList = useLiveQuery(() => db.assets.toArray())
  const refreshedAt = useLiveQuery(() => db.meta.get(QUOTE_META.refreshedAt).then((e) => e?.value as string | undefined))
  const hasKey = useLiveQuery(() => db.meta.get(QUOTE_META.finnhubKey).then((e) => !!e?.value)) ?? false

  const hasYahoo = useLiveQuery(() => db.meta.get(QUOTE_META.yahooProxy).then((e) => !!e?.value)) ?? false
  const baseCurrency = (useLiveQuery(() => db.meta.get(QUOTE_META.baseCurrency).then((e) => e?.value as BaseCurrency | undefined)) ?? 'EUR') as BaseCurrency

  const quotes = useMemo(() => (list ? new Map(list.map((q) => [q.assetId, q])) : EMPTY), [list])

  const loadHistory = useCallback(async () => {
    if (historyRunning.current || !navigator.onLine) return
    historyRunning.current = true
    setHistoryBusy(true)
    try {
      await refreshHistoryNow()
    } catch {
      /* se reintenta en la siguiente actualización */
    } finally {
      historyRunning.current = false
      setHistoryBusy(false)
    }
  }, [])

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (running.current) return undefined
      running.current = true
      setRefreshing(true)
      try {
        const report = await refreshQuotes(undefined, { history: false })
        setLastReport(report)
        if (!silent) toast(summarizeReport(report))
        return report
      } catch {
        if (!silent) toast('No se pudieron actualizar las cotizaciones. Comprueba la conexión.')
        return undefined
      } finally {
        running.current = false
        setRefreshing(false)
        // El histórico va después y aparte: los precios ya se ven y la app no espera.
        void loadHistory()
      }
    },
    [toast, loadHistory],
  )

  // Al abrir la app, actualiza en silencio si hace rato que no se hacía.
  useEffect(() => {
    void (async () => {
      const last = await getMeta<string>(QUOTE_META.refreshedAt)
      if (last && Date.now() - new Date(last).getTime() < AUTO_REFRESH_MS) return
      if (navigator.onLine) await refresh({ silent: true })
    })()
  }, [refresh])

  // Si algún activo o precio está en una divisa sin cambio guardado (p. ej. un precio en
  // dólares añadido antes de pedir USD), se piden los cambios sin esperar a la siguiente vez.
  const attempted = useRef('')
  useEffect(() => {
    if (!fxEntry || !assetList) return
    const missing = missingRates(assetList.filter((a) => !a.deleted), fx).join(',')
    if (!missing || attempted.current === missing || !navigator.onLine) return
    attempted.current = missing
    void refresh({ silent: true })
  }, [fxEntry, fx, assetList, refresh])

  const value = useMemo(
    () => ({ quotes, fx, refreshing, historyBusy, loadHistory, refreshedAt, hasKey, hasYahoo, baseCurrency, lastReport, refresh }),
    [quotes, fx, refreshing, historyBusy, loadHistory, refreshedAt, hasKey, hasYahoo, baseCurrency, lastReport, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useQuotes(): QuotesState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useQuotes necesita <QuotesProvider>')
  return v
}
