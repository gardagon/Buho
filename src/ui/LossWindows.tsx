import { formatMoney } from '../domain/numbers'
import { addMonths, type LossWindow } from '../domain/twoMonths'

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
const day = (s: string) => dateFmt.format(new Date(s + 'T12:00:00'))

export type OpenLossWindow = LossWindow & { daysLeft: number }

/** Una frase por venta con pérdida cuya ventana de recompra sigue abierta. */
export function windowText(w: OpenLossWindow): string {
  const left = w.daysLeft === 1 ? 'falta 1 día' : `faltan ${w.daysLeft} días`
  const base = `Vendiste con ${formatMoney(w.lossEur)} de pérdida el ${day(w.saleDate)}. No recompres antes del ${day(w.safeFrom)} (${left}) o esa pérdida no computará.`
  return w.deferredEur.gt(0)
    ? `${base} Ya has recomprado: ${formatMoney(w.deferredEur)} están diferidos y se recuperarán al vender esos títulos.`
    : base
}

/** Aviso de la regla de los dos meses: qué valores no conviene recomprar todavía y hasta cuándo. */
export function LossWindowsNotice({ windows }: { windows: OpenLossWindow[] }) {
  if (windows.length === 0) return null
  return (
    <div className="notice" role="status">
      <strong>Regla de los dos meses</strong>
      <ul>
        {windows.map((w) => (
          <li key={w.saleMovementId}>
            <strong>{w.asset.name}.</strong> {windowText(w)}
            {w.months === 12 && ' En fondos, la ventana es de un año.'}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Ventanas (abiertas o ya cerradas) en las que una compra en esa fecha difiere la pérdida de una venta. */
export function windowsHitBy(windows: LossWindow[], assetId: string, date: string): LossWindow[] {
  return windows.filter((w) => w.asset.id === assetId && date >= addMonths(w.saleDate, -w.months) && date <= w.until)
}
