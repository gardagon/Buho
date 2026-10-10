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
