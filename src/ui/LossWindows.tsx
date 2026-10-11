import { formatMoney } from '../domain/numbers'
import { addMonths, type LossWindow } from '../domain/twoMonths'
import type { Asset } from '../domain/types'
import { Sheet } from './Sheet'

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
const day = (s: string) => dateFmt.format(new Date(s + 'T12:00:00'))

export type OpenLossWindow = LossWindow & { daysLeft: number }

/** Una frase por venta con pérdida cuya ventana de recompra sigue abierta. */
export function windowText(w: OpenLossWindow): string {
  const left = w.daysLeft === 1 ? 'falta 1 día' : `faltan ${w.daysLeft} días`
  const base = `Vendiste con ${formatMoney(w.lossEur)} de pérdida el ${day(w.saleDate)}. No recompres antes del ${day(w.safeFrom)} (${left}) o esa pérdida no computará.`
  return w.deferredEur.gt(0)
    ? `${base} Por los títulos que tienes comprados dentro de la ventana, ${formatMoney(w.deferredEur)} de la pérdida están diferidos y se recuperarán al vender esos títulos.`
    : base
}

/** Aviso de la regla de los dos meses para un valor: va lo primero en su pantalla. */
export function LossWindowsNotice({ windows }: { windows: OpenLossWindow[] }) {
  if (windows.length === 0) return null
  return (
    <div className="notice" role="status">
      <strong>Regla de los dos meses</strong>
      <ul>
        {windows.map((w) => (
          <li key={w.saleMovementId}>
            {windowText(w)}
            {w.months === 12 && ' En fondos, la ventana es de un año.'}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Pantalla de un valor que ya no se tiene pero cuya ventana de recompra sigue abierta. */
export function LossWindowSheet({ asset, windows, onClose, onOpenMovements }: { asset: Asset; windows: OpenLossWindow[]; onClose: () => void; onOpenMovements: () => void }) {
  return (
    <Sheet
      title={asset.name}
      onClose={onClose}
      onSubmit={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onOpenMovements}>
            Ver movimientos
          </button>
          <span className="spacer" />
          <button type="submit" className="btn">
            Cerrar
          </button>
        </>
      }
    >
      <LossWindowsNotice windows={windows} />
      <p className="small muted" style={{ margin: 0 }}>
        Ya no tienes títulos de este valor.
      </p>
    </Sheet>
  )
}

/** Ventanas (abiertas o ya cerradas) en las que una compra en esa fecha difiere la pérdida de una venta. */
export function windowsHitBy(windows: LossWindow[], assetId: string, date: string): LossWindow[] {
  return windows.filter((w) => w.asset.id === assetId && date >= addMonths(w.saleDate, -w.months) && date <= w.until)
}
