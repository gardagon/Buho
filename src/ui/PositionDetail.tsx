import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../data/db'
import { formatMoney, formatPercent, formatQuantity, formatSignedMoney } from '../domain/numbers'
import { lotDetails } from '../domain/lots'
import { knownPrices, periodPerformance } from '../domain/performance'
import type { Portfolio, Position } from '../domain/portfolio'
import type { Movement, PricePoint, QuoteDay } from '../domain/types'
import { counterPrice, valuePositions } from '../domain/valuation'
import { useQuotes } from '../quotes/QuotesContext'
import { priceNote } from './prices'
import { Sheet } from './Sheet'

const EMPTY_POINTS: PricePoint[] = []
const EMPTY_DAYS: QuoteDay[] = []
const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const day = (s: string) => dateFmt.format(new Date(s + 'T12:00:00'))
const gl = (v: { isNeg(): boolean }) => (v.isNeg() ? 'loss' : 'gain')
const DAY_MS = 86_400_000

const today = () => {
  const n = new Date()
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

interface Props {
  position: Position
  portfolio: Portfolio
  movements: Movement[]
  onClose: () => void
  onOpenMovements: () => void
  onOpenPrices: () => void
}

/** Ficha de una posición: cuánto se tiene, cuánto vale y cómo ha rendido en cada periodo; con el detalle por compra. */
export function PositionDetail({ position, portfolio, movements, onClose, onOpenMovements, onOpenPrices }: Props) {
  const { asset } = position
  const { quotes, fx } = useQuotes()
  const [view, setView] = useState<'resumen' | 'detalle'>('resumen')
  const points = useLiveQuery(() => db.prices.where('assetId').equals(asset.id).toArray(), [asset.id]) ?? EMPTY_POINTS
  const days = useLiveQuery(() => db.quoteDays.where('assetId').equals(asset.id).toArray(), [asset.id]) ?? EMPTY_DAYS

  const mine = useMemo(() => movements.filter((m) => !m.deleted && m.assetId === asset.id), [movements, asset.id])
  const row = useMemo(() => valuePositions([position], quotes, fx).rows[0], [position, quotes, fx])
  const prices = useMemo(() => knownPrices(mine, points, days, fx), [mine, points, days, fx])
  const periods = useMemo(
    () => periodPerformance({ movements: mine, today: today(), valueNowEur: row.valueEur, prices }),
    [mine, row.valueEur, prices],
  )
  const lots = useMemo(() => lotDetails(portfolio, asset.id, mine), [portfolio, asset.id, mine])
  const other = row.price && counterPrice(row.price, fx)
  const unitNowEur = row.valueEur ? row.valueEur.div(position.quantity) : undefined

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
      <div className="segmented" role="radiogroup" aria-label="Vista de la posición">
        {(
          [
            ['resumen', 'Resumen'],
            ['detalle', 'Detalle por compra'],
          ] as const
        ).map(([id, label]) => (
          <label key={id}>
            <input type="radio" name="pos-view" value={id} checked={view === id} onChange={() => setView(id)} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {view === 'resumen' && (
        <>
          <dl className="kv num">
            <div>
              <dt>Acciones</dt>
              <dd>{formatQuantity(position.quantity)}</dd>
            </div>
            <div>
              <dt>Precio medio</dt>
              <dd>
                {formatMoney(position.avgCostEur)}
                {position.costCurrency !== 'EUR' && <span className="muted"> · {formatMoney(position.avgCost, position.costCurrency)}</span>}
              </dd>
            </div>
            <div>
              <dt>Invertido</dt>
              <dd>{formatMoney(position.costEur)}</dd>
            </div>
            <div>
              <dt>Precio ahora</dt>
              <dd>
                {row.price ? formatMoney(row.price.price, row.price.currency) : '—'}
                {other && <span className="muted"> ≈ {formatMoney(other.amount, other.currency)}</span>}
              </dd>
            </div>
            <div>
              <dt>Valor ahora</dt>
              <dd>{row.valueEur ? formatMoney(row.valueEur) : '—'}</dd>
            </div>
            <div>
              <dt>Beneficio</dt>
              <dd className={row.unrealizedEur ? gl(row.unrealizedEur) : undefined}>
                {row.unrealizedEur ? formatSignedMoney(row.unrealizedEur) : '—'}
                {row.unrealizedPct && ` (${formatPercent(row.unrealizedPct)})`}
              </dd>
            </div>
          </dl>
          {row.price ? (
            <p className="small muted">{priceNote(row.price)}</p>
          ) : (
            <p className="small muted">
              No hay precio actual, así que no se puede valorar.{' '}
              <button type="button" className="btn ghost small" style={{ padding: 0 }} onClick={onOpenPrices}>
                Añadir un precio
              </button>
            </p>
          )}

          <section>
            <h3 className="list-title">Cómo ha ido en cada periodo</h3>
            <ul className="rows">
              {periods.map((p) => {
                const stale = p.priceThen && (new Date(p.date).getTime() - new Date(p.priceThen.date).getTime()) / DAY_MS > 3
                return (
                  <li key={p.id}>
                    <div className="row">
                      <span className="row-title">Hace {p.label}</span>
                      <span className={`row-end num ${p.profitEur ? gl(p.profitEur) : ''}`}>
                        <strong>{p.profitEur ? formatSignedMoney(p.profitEur) : '—'}</strong>
                      </span>
                      <span className="row-sub num">
                        {p.status === 'sin-posicion'
                          ? `Desde el ${day(p.date)} · aún no lo tenías`
                          : p.sharesThen.gt(0) && p.priceThen
                            ? `El ${day(p.date)}: ${formatQuantity(p.sharesThen)} × ${formatMoney(p.priceThen.eur)} = ${formatMoney(p.valueThenEur!)}`
                            : `El ${day(p.date)}: aún no tenías títulos`}
                      </span>
                      <span className={`row-sub row-end num ${p.pct ? gl(p.pct) : ''}`}>{p.pct ? formatPercent(p.pct) : ''}</span>
                      {stale && p.priceThen && (
                        <span className="row-sub row-note">Precio conocido más cercano: el {day(p.priceThen.date)}.</span>
                      )}
                      {p.status === 'sin-precio' && (
                        <span className="row-sub row-note">Sin precio de esa fecha. Añádelo en la ficha de precios para calcularlo.</span>
                      )}
                      {p.status === 'sin-precio-actual' && <span className="row-sub row-note">Falta el precio actual.</span>}
                      {p.status === 'ok' && (!p.boughtEur.isZero() || !p.soldEur.isZero() || !p.incomeEur.isZero()) && (
                        <span className="row-sub row-note num">
                          En el periodo:{' '}
                          {[
                            !p.boughtEur.isZero() && `compras ${formatMoney(p.boughtEur)}`,
                            !p.soldEur.isZero() && `ventas ${formatMoney(p.soldEur)}`,
                            !p.incomeEur.isZero() && `dividendos ${formatMoney(p.incomeEur)}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="small muted" style={{ marginTop: 8 }}>
              Beneficio de cada periodo = valor ahora − valor de los títulos que tenías entonces − lo que compraste + lo que
              vendiste + dividendos. El porcentaje es sobre ese dinero de partida más lo comprado. Es lo que ha rendido tu
              inversión en ese tiempo, no lo que tributa.
            </p>
          </section>
        </>
      )}

      {view === 'detalle' && (
        <section>
          <p className="small muted">
            Cada compra con las ventas que han salido de ella (las más antiguas se venden primero). Si una venta sale de
            varias compras, sus comisiones se reparten por títulos.
          </p>
          <div className="lots">
            {lots.map((l) => {
              const remainingValue = unitNowEur ? l.remaining.mul(unitNowEur) : undefined
              const remainingProfit = remainingValue ? remainingValue.minus(l.remaining.mul(l.unitCostEur)) : undefined
              return (
                <article key={l.buy.id} className="lot">
                  <header className="lot-head">
                    <strong>Compra del {day(l.buy.date)}</strong>
                    <span className="small muted">
                      {l.status === 'abierta' ? 'Abierta' : l.status === 'parcial' ? 'Vendida en parte' : 'Vendida'}
                    </span>
                  </header>
                  <p className="num">
                    {formatQuantity(l.quantity)} × {formatMoney(l.buy.price ?? '0', l.buy.currency)} ={' '}
                    <strong>{formatMoney(l.costEur)}</strong>
                  </p>
                  <p className="small muted num">
                    Precio medio con comisiones {formatMoney(l.unitCostEur)}
                    {l.buy.fees !== '0' && ` · comisiones ${formatMoney(l.buy.fees, l.buy.currency)}`}
                    {l.buy.account && ` · ${l.buy.account}`}
                  </p>
                  {l.slices.map((s) => (
                    <div key={s.saleMovementId + s.quantity.toString()} className="lot-sale">
                      <div className="lot-sale-title">Venta del {day(s.date)}</div>
                      <div className="num">
                        {formatQuantity(s.quantity)} × {formatMoney(s.price, s.currency)} = {formatMoney(s.proceedsEur)}
                      </div>
                      <div className={`num ${gl(s.profitEur)}`}>
                        Beneficio {formatSignedMoney(s.profitEur)}
                        {s.profitPct && ` (${formatPercent(s.profitPct)})`}
                      </div>
                    </div>
                  ))}
                  {l.remaining.gt(0) && (
                    <div className="lot-sale lot-open">
                      <div className="lot-sale-title">
                        {l.slices.length > 0 ? 'Aún tienes' : 'Sin vender'}: {formatQuantity(l.remaining)} títulos
                      </div>
                      {remainingValue && remainingProfit ? (
                        <div className={`num ${gl(remainingProfit)}`}>
                          Valen {formatMoney(remainingValue)} · beneficio {formatSignedMoney(remainingProfit)}
                        </div>
                      ) : (
                        <div className="small muted">Sin precio actual para valorarlos.</div>
                      )}
                    </div>
                  )}
                  {l.slices.length > 0 && (
                    <p className="small muted num">Beneficio ya realizado: {formatSignedMoney(l.realizedProfitEur)}</p>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      )}
    </Sheet>
  )
}
