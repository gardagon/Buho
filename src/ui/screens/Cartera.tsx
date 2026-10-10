import { useMemo, useState } from 'react'
import { formatMoney, formatPercent, formatQuantity, formatSignedMoney } from '../../domain/numbers'
import { valuePositions } from '../../domain/valuation'
import { useQuotes } from '../../quotes/QuotesContext'
import { priceNote, RefreshLine } from '../prices'
import { summarizeByYear, type Portfolio } from '../../domain/portfolio'
import { ASSET_TYPES, type AssetType, type Movement } from '../../domain/types'
import { Historico } from '../Historico'
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
  movements: Movement[]
  onAdd: () => void
  onOpenAsset: (assetId: string) => void
}

export function Cartera({ portfolio, movements, onAdd, onOpenAsset }: Props) {
  const { positions, totalCostEur, issues } = portfolio
  const years = useMemo(() => summarizeByYear(portfolio), [portfolio])
  const [view, setView] = useState<'activa' | 'historico'>('activa')
  const { quotes, fx } = useQuotes()
  const valuation = useMemo(() => valuePositions(positions, quotes, fx), [positions, quotes, fx])
  const valuedCount = positions.length - valuation.unvalued
  const rowByAsset = useMemo(() => new Map(valuation.rows.map((r) => [r.position.asset.id, r])), [valuation])

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
          <p>Tu cartera sale de tus movimientos.</p>
          <p>Registra tu primera compra en la pestaña Movimientos y aquí verás lo que tienes ahora y, cuando vendas, tu histórico con las plusvalías por año.</p>
          <button className="btn primary" onClick={onAdd}>
            Ir a Movimientos
          </button>
        </div>
      </>
    )
  }

  const thisYear = years.find((y) => y.year === String(new Date().getFullYear()))

  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Vista de la cartera" style={{ marginBottom: 20 }}>
        {(
          [
            ['activa', 'Activa'],
            ['historico', 'Histórico'],
          ] as const
        ).map(([id, label]) => (
          <label key={id}>
            <input type="radio" name="cartera-view" value={id} checked={view === id} onChange={() => setView(id)} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {view === 'activa' && (
        <>
      <p className="summary">
        {valuedCount > 0 ? (
          <>
            Tu cartera vale <strong className="num">{formatMoney(valuation.valueEur)}</strong>
            {valuation.unrealizedPct && (
              <>
                , un{' '}
                <strong className={`num ${valuation.unrealizedEur.isNeg() ? 'loss' : 'gain'}`}>
                  {formatSignedMoney(valuation.unrealizedEur)} ({formatPercent(valuation.unrealizedPct)})
                </strong>{' '}
                sobre lo que pusiste
              </>
            )}
            .
          </>
        ) : positions.length > 0 ? (
          <>
            Tienes <strong className="num">{formatMoney(totalCostEur)}</strong> invertidos en{' '}
            {positions.length === 1 ? 'un activo' : `${positions.length} activos`}.
          </>
        ) : (
          'No tienes posiciones abiertas.'
        )}
      </p>
      {valuation.unvalued > 0 && valuedCount > 0 && (
        <p className="small muted">
          {valuation.unvalued === 1 ? 'Una posición no se puede valorar' : `${valuation.unvalued} posiciones no se pueden valorar`}{' '}
          y no cuentan en el valor total. Les falta el precio (ponlo a mano en Activos) o el tipo de cambio (actualiza).
        </p>
      )}


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
          <h2>Posiciones</h2>
          <RefreshLine />
          <ul className="rows">
            {positions.map((p) => {
              const v = rowByAsset.get(p.asset.id)
              return (
                <li key={p.asset.id}>
                  <button className="row" onClick={() => onOpenAsset(p.asset.id)}>
                    <span className="row-title">{p.asset.name}</span>
                    <span className="row-end num">
                      <strong>{formatMoney(v?.valueEur ?? p.costEur)}</strong>
                    </span>
                    <span className="row-sub num">
                      {v?.price
                        ? `${formatQuantity(p.quantity)} × ${formatMoney(v.price.price, v.price.currency)}`
                        : `${formatQuantity(p.quantity)} × ${formatMoney(p.avgCost, p.costCurrency)} de coste medio`}
                    </span>
                    {v?.unrealizedEur ? (
                      <span className={`row-sub row-end num ${v.unrealizedEur.isNeg() ? 'loss' : 'gain'}`}>
                        {formatSignedMoney(v.unrealizedEur)}
                        {v.unrealizedPct && ` (${formatPercent(v.unrealizedPct)})`}
                      </span>
                    ) : (
                      <span className="row-sub row-end">
                        {v?.missingFx
                          ? `Falta el cambio ${v.price?.currency ?? p.asset.currency}/EUR · actualiza`
                          : v?.price
                            ? priceNote(v.price)
                            : 'Sin precio · coste ' + formatMoney(p.costEur)}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="small muted" style={{ marginTop: 8 }}>
            El valor usa el último precio disponible y el cambio actual del BCE. La plusvalía latente es orientativa: el coste
            es FIFO con comisiones, el que usa Hacienda.
          </p>
        </section>
      )}

        </>
      )}

      {view === 'historico' && (
        <>
      <p className="summary">
        {thisYear ? (
          <>
            En {thisYear.year} llevas{' '}
            <strong className={`num ${thisYear.netGainEur.isNeg() ? 'loss' : 'gain'}`}>
              {formatSignedMoney(thisYear.netGainEur)}
            </strong>{' '}
            en ventas.
          </>
        ) : years.length > 0 ? (
          'Este año no has vendido nada.'
        ) : (
          'Todavía no has vendido nada.'
        )}
      </p>

      <Historico portfolio={portfolio} movements={movements} />
        </>
      )}
    </>
  )
}
