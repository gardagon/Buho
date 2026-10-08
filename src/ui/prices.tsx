import type { PriceInfo } from '../domain/valuation'
import { useQuotes } from '../quotes/QuotesContext'

const dateTime = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

/** «Cotización del 8 oct, 10:15» o «Precio manual del 8 oct 2026». */
export function priceNote(p: PriceInfo): string {
  if (p.source === 'manual') return p.at ? `Precio manual del ${dateOnly.format(new Date(p.at))}` : 'Precio manual'
  return `Cotización del ${dateTime.format(new Date(p.at))}`
}

/** Última actualización y botón para pedir cotizaciones y tipos de cambio. */
export function RefreshLine() {
  const { refresh, refreshing, refreshedAt } = useQuotes()
  return (
    <div className="refresh-line">
      <p className="small muted">
        {refreshedAt ? `Actualizado el ${dateTime.format(new Date(refreshedAt))}` : 'Sin actualizar todavía'}
      </p>
      <button className="btn small" onClick={() => void refresh()} disabled={refreshing}>
        {refreshing ? 'Actualizando…' : 'Actualizar precios'}
      </button>
    </div>
  )
}
