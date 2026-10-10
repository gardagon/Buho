import { useMemo } from 'react'
import { d, formatMoney, formatQuantity } from '../domain/numbers'
import { toEur, type Portfolio } from '../domain/portfolio'
import { yearReport } from '../domain/sales'
import { MOVEMENT_TYPES, type Asset, type Movement } from '../domain/types'
import { Lines, SaleCard } from './Historico'
import { Sheet } from './Sheet'

const dateFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

interface Props {
  movement: Movement
  asset?: Asset
  portfolio: Portfolio
  movements: Movement[]
  onClose: () => void
  onEdit: () => void
}

/**
 * Ficha de solo lectura de un movimiento. Si es una venta, trae también las
 * compras de las que salen sus títulos (FIFO). Para cambiar algo hay que pulsar
 * «Editar movimiento»: así no se abre el formulario por un toque sin querer.
 */
export function MovementDetail({ movement: m, asset, portfolio, movements, onClose, onEdit }: Props) {
  const report = useMemo(() => yearReport(portfolio, movements, m.date.slice(0, 4)), [portfolio, movements, m.date])
  const assetYear = report.assets.find((a) => a.asset.id === m.assetId)
  const sale = m.type === 'venta' ? assetYear?.sales.find((s) => s.movementId === m.id) : undefined
  const income = m.type === 'dividendo' || m.type === 'cupon' ? assetYear?.incomes.find((i) => i.movementId === m.id) : undefined

  const rows: ([string, string] | [string, string, string | undefined])[] = []
  if (m.type === 'compra') {
    const gross = d(m.quantity ?? '0').mul(d(m.price ?? '0'))
    const total = m.totalEur ? d(m.totalEur) : toEur(gross.plus(d(m.fees)), m.fxRate)
    rows.push(['Cantidad', formatQuantity(m.quantity ?? '0')], ['Precio', formatMoney(m.price ?? '0', m.currency)])
    if (m.currency !== 'EUR') rows.push(['Cambio', formatQuantity(m.fxRate)])
    rows.push(['Importe', formatMoney(gross, m.currency)], ['Comisiones', formatMoney(m.fees, m.currency)], ['Total pagado', formatMoney(total)])
  } else if (!sale) {
    const gross = d(m.amount ?? '0')
    const net = income?.netEur ?? toEur(gross.minus(d(m.withholding)).minus(d(m.fees)), m.fxRate)
    if (m.currency !== 'EUR') rows.push(['Cambio', formatQuantity(m.fxRate)])
    rows.push(
      ['Bruto', formatMoney(gross, m.currency)],
      ['Retención', formatMoney(m.withholding, m.currency)],
      ['Comisiones', formatMoney(m.fees, m.currency)],
      ['Neto cobrado', m.currency === 'EUR' ? formatMoney(net) : formatMoney(net) + ' (EUR)', 'gain'],
    )
  }

  return (
    <Sheet
      title={asset?.name ?? 'Activo eliminado'}
      tone={m.type}
      onClose={onClose}
      onSubmit={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cerrar
          </button>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={onEdit}>
            Editar movimiento
          </button>
        </>
      }
    >
      <p className="movement-head">
        <span className={`tag ${m.type}`}>{MOVEMENT_TYPES[m.type]}</span> <span className="muted">{dateFmt.format(new Date(m.date + 'T12:00:00'))}</span>
      </p>

      {sale ? (
        <SaleCard sale={sale} />
      ) : (
        <section className="block movement-block">
          <Lines rows={rows} />
        </section>
      )}

      {(m.account || m.note) && (
        <dl className="lines">
          {m.account && (
            <div>
              <dt>Cuenta</dt>
              <dd>{m.account}</dd>
            </div>
          )}
          {m.note && (
            <div>
              <dt>Nota</dt>
              <dd style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{m.note}</dd>
            </div>
          )}
        </dl>
      )}
    </Sheet>
  )
}
