import { useMemo } from 'react'
import { d, formatMoney, formatQuantity } from '../../domain/numbers'
import { toEur } from '../../domain/portfolio'
import { MOVEMENT_TYPES, type Asset, type Movement } from '../../domain/types'

interface Props {
  movements: Movement[]
  assets: Asset[]
  onOpen: (m: Movement) => void
  onAdd: () => void
  filter: string
  onFilter: (assetId: string) => void
}

const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function netAmount(m: Movement) {
  if (m.type === 'compra' && m.totalEur) return d(m.totalEur).neg()
  if (m.type === 'venta' && m.totalEur) return d(m.totalEur)
  if (m.type === 'compra') return d(m.quantity).mul(d(m.price)).plus(d(m.fees)).neg()
  if (m.type === 'venta') return d(m.quantity).mul(d(m.price)).minus(d(m.fees))
  return d(m.amount).minus(d(m.withholding)).minus(d(m.fees))
}

export function Movimientos({ movements, assets, onOpen, onAdd, filter, onFilter }: Props) {
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])

  const groups = useMemo(() => {
    const list = movements
      .filter((m) => !filter || m.assetId === filter)
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
    const map = new Map<string, Movement[]>()
    for (const m of list) map.set(m.date, [...(map.get(m.date) ?? []), m])
    return [...map.entries()]
  }, [movements, filter])

  return (
    <>
      <div className="screen-head">
        <h1>Movimientos</h1>
        {assets.length > 1 && (
          <label className="field" style={{ maxWidth: 200 }}>
            <span className="visually-hidden">Filtrar por activo</span>
            <select value={filter} onChange={(e) => onFilter(e.target.value)}>
              <option value="">Todos los activos</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          <p>Aquí aparecerán tus compras, ventas, dividendos y cupones, del más reciente al más antiguo.</p>
          <button className="btn primary" onClick={onAdd}>
            Añadir movimiento
          </button>
        </div>
      ) : (
        groups.map(([date, ms]) => (
          <div key={date}>
            <h3 className="day-label">{dayFmt.format(new Date(date + 'T12:00:00'))}</h3>
            <ul className="rows">
              {ms.map((m) => {
                const a = assetById.get(m.assetId)
                const net = netAmount(m)
                // Con el total real en EUR, el importe ya está en euros.
                const netCurrency = m.totalEur && (m.type === 'compra' || m.type === 'venta') ? 'EUR' : m.currency
                return (
                  <li key={m.id}>
                    <button className="row" onClick={() => onOpen(m)}>
                      <span className="row-title">{a?.name ?? 'Activo eliminado'}</span>
                      <span className={`row-end num ${net.isNeg() ? '' : 'gain'}`}>
                        <strong>{(net.isNeg() ? '−' : '+') + formatMoney(net.abs(), netCurrency)}</strong>
                      </span>
                      <span className="row-sub num">
                        <span className={`tag ${m.type}`}>{MOVEMENT_TYPES[m.type]}</span>{' '}
                        {m.quantity && m.price
                          ? `${formatQuantity(m.quantity)} × ${formatMoney(m.price, m.currency)}`
                          : m.withholding !== '0'
                            ? `Retención ${formatMoney(m.withholding, m.currency)}`
                            : ''}
                      </span>
                      <span className="row-sub row-end num">
                        {netCurrency !== 'EUR' ? formatMoney(toEur(net.abs(), m.fxRate)) : (m.account ?? '')}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </>
  )
}
