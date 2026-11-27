import { useMemo } from 'react'
import { d, formatMoney, formatQuantity } from '../domain/numbers'
import { incomeBreakdown } from '../domain/income'
import { toEur, type Portfolio } from '../domain/portfolio'
import { yearReport } from '../domain/sales'
import { rightsGross } from '../domain/scrip'
import { MOVEMENT_TYPES, type Asset, type Movement } from '../domain/types'
import { Lines, SaleCard } from './Historico'
import { Sheet } from './Sheet'

const dateFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

interface Props {
  movement: Movement
  asset?: Asset
  /** Traspaso: el fondo de destino. */
  toAsset?: Asset
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
export function MovementDetail({ movement: m, asset, toAsset, portfolio, movements, onClose, onEdit }: Props) {
  const report = useMemo(() => yearReport(portfolio, movements, m.date.slice(0, 4)), [portfolio, movements, m.date])
  const assetYear = report.assets.find((a) => a.asset.id === m.assetId)
  const sale = m.type === 'venta' ? assetYear?.sales.find((s) => s.movementId === m.id) : undefined

  const rows: ([string, string] | [string, string, string | undefined])[] = []
  const scripEvent = m.type === 'scrip' ? portfolio.scrips.find((e) => e.movementId === m.id) : undefined
  /** Bruto, retenciones, comisiones y neto de un cobro (dividendo, cupón o derechos vendidos). */
  const moneyRows = (src: Movement) => {
    const b = incomeBreakdown(src)
    const split = src.withholdingOrigin !== undefined || src.withholdingDest !== undefined
    if (src.currency !== 'EUR') rows.push(['Cambio', formatQuantity(src.fxRate)])
    rows.push(['Bruto', formatMoney(src.amount ?? '0', src.currency) + (src.currency !== 'EUR' ? ` (${formatMoney(b.grossEur)})` : '')])
    if (split) {
      const part = (label: string, v: string | undefined, c: string | undefined, e: typeof b.grossEur) => {
        if (v === undefined || d(v).isZero()) return
        const cur = c ?? src.currency
        rows.push([label, formatMoney(v, cur) + (cur !== 'EUR' ? ` (${formatMoney(e)})` : '')])
      }
      part('Retención en origen', src.withholdingOrigin, src.withholdingOriginCurrency, b.originEur)
      part('Retención en España', src.withholdingDest, src.withholdingDestCurrency, b.destEur)
    } else if (!b.unclassifiedEur.isZero()) {
      rows.push(['Retención', formatMoney(b.unclassifiedEur)])
    }
    if (!b.feesEur.isZero()) rows.push(['Comisiones', formatMoney(b.feesEur)])
    rows.push(['Neto cobrado', formatMoney(b.netEur), 'gain'])
  }
  if (m.type === 'scrip') {
    rows.push(['Derechos recibidos', formatQuantity(scripEvent?.rights ?? m.quantity ?? '0')])
    if (m.scripRatio) rows.push(['Derechos por acción nueva', formatQuantity(m.scripRatio)])
    if (m.newShares && d(m.newShares).gt(0)) rows.push(['Acciones nuevas', formatQuantity(m.newShares), 'gain'])
    if (m.rightsSold && d(m.rightsSold).gt(0)) {
      rows.push([m.rightsSoldTo === 'mercado' ? 'Derechos vendidos en el mercado' : 'Derechos vendidos a la empresa', formatQuantity(m.rightsSold)])
      if (m.price) rows.push(['Precio por derecho', formatMoney(m.price, m.currency)])
      moneyRows({ ...m, amount: rightsGross(m).toString() })
    }
    if (scripEvent?.rightsLeft.gt(0)) rows.push(['Derechos sin vender ni cambiar', formatQuantity(scripEvent.rightsLeft)])
  } else if (m.type === 'compra') {
    const gross = d(m.quantity ?? '0').mul(d(m.price ?? '0'))
    const total = m.totalEur ? d(m.totalEur) : toEur(gross.plus(d(m.fees)).plus(d(m.taxes ?? '0')), m.fxRate)
    rows.push(['Cantidad', formatQuantity(m.quantity ?? '0')], ['Precio', formatMoney(m.price ?? '0', m.currency)])
    if (m.currency !== 'EUR') rows.push(['Cambio', formatQuantity(m.fxRate)])
    rows.push(['Importe', formatMoney(gross, m.currency)], ['Comisiones', formatMoney(m.fees, m.currency)])
    if (m.taxes && !d(m.taxes).isZero()) rows.push(['Impuestos', formatMoney(m.taxes, m.currency)])
    rows.push(['Total pagado', formatMoney(total)])
  } else if (m.type === 'traspaso') {
    rows.push(
      ['Fondo de origen', asset?.name ?? 'Activo eliminado'],
      ['Fondo de destino', toAsset?.name ?? 'Activo eliminado'],
      ['Participaciones que salen', formatQuantity(m.quantity ?? '0')],
      ['Participaciones que entran', formatQuantity(m.toQuantity ?? '0')],
    )
  } else if (!sale) {
    moneyRows(m)
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
        <>
          <section className="block movement-block">
            <Lines rows={rows} />
          </section>
          {m.type === 'scrip' && scripEvent && <ScripDetail event={scripEvent} soldTo={m.rightsSoldTo} />}
          {m.type === 'traspaso' && (
            <p className="small muted" style={{ margin: 0 }}>
              No tributa: el fondo de destino hereda la fecha de compra y el coste de las participaciones traspasadas (art. 94 LIRPF).
            </p>
          )}
        </>
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

/** Dividendo flexible: cómo tributa cada parte y cómo se reparten las acciones nuevas entre las compras. */
function ScripDetail({ event: e, soldTo }: { event: NonNullable<Portfolio['scrips'][number]>; soldTo?: Movement['rightsSoldTo'] }) {
  const withShares = e.lots.filter((l) => l.newShares.gt(0))
  return (
    <>
      {e.newShares.gt(0) && (
        <p className="small muted" style={{ margin: 0 }}>
          Las acciones nuevas no tributan al recibirlas. El coste de cada compra se reparte entre sus acciones y las nuevas que salen de sus derechos, y
          las nuevas conservan su fecha de compra (art. 37.1.a LIRPF). Tu coste medio pasa de {formatMoney(e.avgCostEurBefore)} a{' '}
          {formatMoney(e.avgCostEurAfter)} por acción; el coste total no cambia.
        </p>
      )}
      {e.rightsSold.gt(0) && (
        <p className="small muted" style={{ margin: 0 }}>
          {soldTo === 'mercado'
            ? 'Los derechos vendidos en el mercado cuentan como ganancia patrimonial: desde 2017, todo lo cobrado es ganancia (coste 0). Aparecen en Ventas, no en Dividendos.'
            : 'Los derechos vendidos a la empresa a precio fijo cuentan como dividendo (rendimiento del capital mobiliario).'}
        </p>
      )}
      {withShares.length > 0 && (
        <section className="block movement-block">
          <h3 className="list-title">Reparto entre tus compras</h3>
          {e.lots.map((l) => (
            <div key={l.buyMovementId} className="piece">
              <div className="piece-title">Compra del {shortFmt.format(new Date(l.buyDate + 'T12:00:00'))}</div>
              <Lines
                rows={[
                  ['Derechos', formatQuantity(l.rights)],
                  ...(l.rightsSold.gt(0) ? ([['Vendidos o sobrantes (los más antiguos)', formatQuantity(l.rightsSold)]] as [string, string][]) : []),
                  ['Cambiados por acciones', formatQuantity(l.rightsUsed)],
                  ['Acciones nuevas', '+' + formatQuantity(l.newShares.toDecimalPlaces(4)), l.newShares.gt(0) ? 'gain' : undefined],
                  ['Acciones', `${formatQuantity(l.quantityBefore.toDecimalPlaces(4))} → ${formatQuantity(l.quantityBefore.plus(l.newShares).toDecimalPlaces(4))}`],
                  ['Coste por acción', `${formatMoney(l.unitCostEurBefore)} → ${formatMoney(l.unitCostEurAfter)}`],
                ]}
              />
            </div>
          ))}
        </section>
      )}
    </>
  )
}
