import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { clearNetLog, netLog, subscribeNetLog } from '../quotes/http'
import { db } from '../data/db'
import { QUOTE_META } from '../data/repo'
import type { PriceInfo } from '../domain/valuation'
import { useQuotes } from '../quotes/QuotesContext'

const dateTime = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const dayMonth = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
const dateOnly = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/** «Cotización del 8 oct, 10:15» o «Precio manual del 8 oct 2026». */
export function priceNote(p: PriceInfo): string {
  if (p.source === 'manual') return p.at ? `Precio manual del ${dateOnly.format(new Date(p.at))}` : 'Precio manual'
  return `Cotización del ${dateTime.format(new Date(p.at))}`
}

/**
 * «9 oct, 10:15» para una cotización; «9 oct (manual)» para un precio puesto a mano
 * (de ese no se sabe la hora). Incluye el año si no es el actual.
 */
export function priceStamp(p: PriceInfo): string {
  if (p.source === 'manual') {
    if (!p.at) return '(manual)'
    const d = new Date(p.at + 'T12:00:00')
    const fmt = d.getFullYear() === new Date().getFullYear() ? dayMonth : dateOnly
    return `${fmt.format(d)} (manual)`
  }
  return dateTime.format(new Date(p.at))
}

/** Última actualización y botón para pedir cotizaciones y tipos de cambio. */
export function RefreshLine() {
  const { refresh, refreshing, refreshedAt, historyBusy } = useQuotes()
  return (
    <div className="refresh-line">
      <p className="small muted">
        {refreshedAt ? `Actualizado el ${dateTime.format(new Date(refreshedAt))}` : 'Sin actualizar todavía'}
        {historyBusy && ' · Bajando el histórico en segundo plano'}
      </p>
      <button className="btn small" onClick={() => void refresh()} disabled={refreshing}>
        {refreshing ? 'Actualizando…' : 'Actualizar precios'}
      </button>
    </div>
  )
}

const secs = (ms?: number) => (ms === undefined ? undefined : `${(ms / 1000).toFixed(1).replace('.', ',')} s`)

/** Cuánto tardó la última actualización de precios y la última descarga de histórico: para ver dónde se va el tiempo. */
export function LastRunInfo() {
  const run = useLiveQuery(() => db.meta.get(QUOTE_META.lastRun).then((e) => e?.value as Record<string, number | string> | undefined))
  const hist = useLiveQuery(() => db.meta.get(QUOTE_META.lastHistoryRun).then((e) => e?.value as Record<string, number | string> | undefined))
  if (!run && !hist) return null
  const parts = run
    ? [
        run.finnhubMs !== undefined && `Finnhub ${secs(run.finnhubMs as number)}`,
        run.yahooMs !== undefined && `Yahoo ${secs(run.yahooMs as number)}`,
        run.fxMs !== undefined && `cambios ${secs(run.fxMs as number)}`,
      ].filter(Boolean)
    : []
  return (
    <div className="small muted num">
      {run && (
        <p>
          Última actualización ({dateTime.format(new Date(run.at as string))}): {run.updated as number} valores en {secs(run.totalMs as number)}
          {parts.length > 0 && ` (${parts.join(' · ')})`}
          {(run.failed as number) > 0 && `, ${run.failed} con error`}.
        </p>
      )}
      {hist && (
        <p>
          Último histórico ({dateTime.format(new Date(hist.at as string))}): {hist.days as number} días en {secs(hist.ms as number)}
          {(hist.failed as number) > 0 && `, ${hist.failed} con error`}.
        </p>
      )}
    </div>
  )
}

const clock = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Registro de las últimas peticiones de red de las cotizaciones: destino, estado y lo que tardó. */
export function NetDebug() {
  const entries = useSyncExternalStore(subscribeNetLog, netLog)
  const text = () => entries.map((e) => `${clock.format(new Date(e.at))}  ${(e.ms / 1000).toFixed(1)} s  ${e.status}  ${e.target}`).join('\n')
  return (
    <>
      <LastRunInfo />
      {entries.length === 0 ? (
        <p className="small muted">Todavía no hay peticiones. Pulsa «Actualizar precios» y vuelve aquí.</p>
      ) : (
        <ul className="net-log num small">
          {entries.map((e, i) => (
            <li key={i} className={e.status === 'timeout' || e.status === 'error' || e.status >= 400 ? 'loss' : e.ms > 5000 ? 'slow' : undefined}>
              <span>{(e.ms / 1000).toFixed(1).replace('.', ',')} s</span>
              <span>{e.status}</span>
              <span className="net-target">{e.target}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button className="btn small" disabled={entries.length === 0} onClick={() => void navigator.clipboard?.writeText(text())}>
          Copiar el registro
        </button>
        <button className="btn ghost small" disabled={entries.length === 0} onClick={clearNetLog}>
          Vaciar
        </button>
      </div>
    </>
  )
}
