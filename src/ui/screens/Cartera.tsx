import { useMemo } from 'react'
import { formatMoney, formatQuantity, formatSignedMoney } from '../../domain/numbers'
import { summarizeByYear, type Portfolio } from '../../domain/portfolio'
import { ASSET_TYPES, type AssetType } from '../../domain/types'
import { Decimal } from '../../domain/numbers'

export const TYPE_COLORS: Record<AssetType, string> = {
  accion: '#e8ab2c',
  etf: '#4f86c6',
  fondo: '#5fa383',
  bono: '#8d6cbb',
  materia_prima: '#c8774a',
  cripto: '#3ea6a2',
  otro: '#8a96a0',
}

interface Props {
  portfolio: Portfolio
  hasAssets: boolean
  onAdd: () => void
  onOpenAsset: (assetId: string) => void
}

export function Cartera({ portfolio, hasAssets, onAdd, onOpenAsset }: Props) {
  const { positions, totalCostEur, issues } = portfolio
  const years = useMemo(() => summarizeByYear(portfolio), [portfolio])

  const mix = useMemo(() => {
    const m = new Map<AssetType, Decimal>()
    for (const p of positions) m.set(p.asset.type, (m.get(p.asset.type) ?? new Decimal(0)).plus(p.costEur))
    return [...m.entries()].sort((a, b) => b[1].cmp(a[1]))
  }, [positions])

  if (positions.length === 0 && years.length === 0) {
    return (
      <>
        <div className="screen-head">
          <h1>Cartera</h1>
        </div>
        <div className="empty">
          <p>Todavía no hay nada que vigilar.</p>
          <p>Añade tu primera compra y aquí verás tus posiciones, lo que te costaron y tus plusvalías por año.</p>
          <button className="btn primary" onClick={onAdd}>
            {hasAssets ? 'Añadir movimiento' : 'Añadir primera compra'}
          </button>
        </div>
      </>
    )
  }

  const thisYear = years.find((y) => y.year === String(new Date().getFullYear()))

  return (
    <>
      <p className="summary">
        Tienes <strong className="num">{formatMoney(totalCostEur)}</strong> invertidos en{' '}
        {positions.length === 1 ? 'un activo' : `${positions.length} activos`}.
        {thisYear && !thisYear.netGainEur.isZero() && (
          <>
            {' '}
            Este año llevas{' '}
            <strong className={`num ${thisYear.netGainEur.isNeg() ? 'loss' : 'gain'}`}>
              {formatSignedMoney(thisYear.netGainEur)}
            </strong>{' '}
            en ventas.
          </>
        )}
      </p>

      {issues.length > 0 && (
        <div className="notice" role="alert">
          <strong>Hay movimientos que no cuadran.</strong>
          <ul>
            {issues.map((i) => (
              <li key={i.movementId}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      {mix.length > 0 && (
        <div className="mix">
          <div className="mix-bar" role="img" aria-label="Reparto del capital invertido por tipo de activo">
            {mix.map(([t, v]) => (
              <span key={t} style={{ flexGrow: Number(v.toFixed(2)), background: TYPE_COLORS[t] }} />
            ))}
          </div>
          <ul className="mix-legend">
            {mix.map(([t, v]) => (
              <li key={t} className="num">
                <i style={{ background: TYPE_COLORS[t] }} />
                {ASSET_TYPES[t]} {v.div(totalCostEur).mul(100).toFixed(0)} %
              </li>
            ))}
          </ul>
        </div>
      )}

      {positions.length > 0 && (
        <section>
          <h2>Posiciones a coste</h2>
          <ul className="rows">
            {positions.map((p) => (
              <li key={p.asset.id}>
                <button className="row" onClick={() => onOpenAsset(p.asset.id)}>
                  <span className="row-title">{p.asset.name}</span>
                  <span className="row-end num">
                    <strong>{formatMoney(p.costEur)}</strong>
                  </span>
                  <span className="row-sub num">
                    {formatQuantity(p.quantity)} × {formatMoney(p.avgCost, p.asset.currency)} de coste medio
                  </span>
                  <span className="row-sub row-end">{p.asset.ticker ?? ASSET_TYPES[p.asset.type]}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ marginTop: 8 }}>
            Coste calculado por FIFO e incluyendo comisiones. La valoración a precio de mercado llegará con las cotizaciones.
          </p>
        </section>
      )}

      {years.length > 0 && (
        <section>
          <h2>Resultados por año</h2>
          <div className="table-wrap">
            <table className="years num">
              <thead>
                <tr>
                  <th>Año</th>
                  <th>Plusvalías</th>
                  <th>Minusvalías</th>
                  <th>Neto ventas</th>
                  <th>Dividendos y cupones</th>
                  <th>Retenciones</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td className="gain">{formatMoney(y.gainsEur)}</td>
                    <td className="loss">{formatMoney(y.lossesEur.abs())}</td>
                    <td className={y.netGainEur.isNeg() ? 'loss' : 'gain'}>{formatSignedMoney(y.netGainEur)}</td>
                    <td>{formatMoney(y.incomeGrossEur)}</td>
                    <td>{formatMoney(y.withholdingEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Orientativo. Aún no aplica la regla de los dos meses ni los traspasos entre fondos; compruébalo antes de usarlo en la declaración.
          </p>
        </section>
      )}
    </>
  )
}
