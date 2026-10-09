import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../data/db'
import { addPricePoint, deletePricePoint } from '../data/repo'
import { Decimal, formatMoney, formatPercent, parseUserNumber } from '../domain/numbers'
import { counterPrice, dayChange, pickPrice, priceHistory, priceToEur } from '../domain/valuation'
import type { Asset, PricePoint, QuoteDay } from '../domain/types'
import { useQuotes } from '../quotes/QuotesContext'
import { rateForPoint } from '../quotes/fx'
import { priceNote } from './prices'
import { PriceChart } from './PriceChart'
import { Field, Sheet } from './Sheet'
import { Spinner } from './Spinner'
import { useToast } from './Toast'

const EMPTY_POINTS: PricePoint[] = []
const EMPTY_DAYS: QuoteDay[] = []
const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })

const today = () => {
  const n = new Date()
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

interface Props {
  asset: Asset
  onClose: () => void
  onEdit: () => void
}

/** Ficha de un valor: precio actual en dos monedas, evolución e histórico de precios. */
export function PriceDetail({ asset, onClose, onEdit }: Props) {
  const toast = useToast()
  const { quotes, fx } = useQuotes()
  const points = useLiveQuery(() => db.prices.where('assetId').equals(asset.id).toArray(), [asset.id]) ?? EMPTY_POINTS
  const days = useLiveQuery(() => db.quoteDays.where('assetId').equals(asset.id).toArray(), [asset.id]) ?? EMPTY_DAYS
  const [date, setDate] = useState(today())
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(asset.manualPriceCurrency ?? asset.currency)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)

  const current = pickPrice(asset, quotes.get(asset.id))
  const other = current && counterPrice(current, fx)
  const change = current && dayChange(current)
  const live = useMemo(() => points.filter((p) => !p.deleted).sort((a, b) => (a.date < b.date ? 1 : -1)), [points])
  const series = useMemo(() => priceHistory(points, days, fx), [points, days, fx])
  const options = [...new Set([asset.currency, 'EUR', 'USD'])]

  const parsed = parseUserNumber(price)
  const priceOk = parsed !== null && Number(parsed) > 0
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date)

  async function submit() {
    setTried(true)
    if (!priceOk || !dateOk || saving) return
    setSaving(true)
    try {
      // Cambio del BCE de ese día, para poder comparar el histórico en euros aunque el precio sea en dólares.
      const fxRate = await rateForPoint(currency, date)
      await addPricePoint(asset.id, { date, price: parsed!, currency, fxRate })
    } catch (e) {
      setSaving(false)
      toast(`No se pudo guardar el precio: ${e instanceof Error ? e.message : 'error desconocido'}. Inténtalo de nuevo.`)
      return
    }
    setSaving(false)
    setPrice('')
    setTried(false)
    toast('Precio añadido')
  }

  return (
    <Sheet
      title={asset.name}
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onEdit} disabled={saving}>
            Editar activo
          </button>
          <span className="spacer" />
          <button type="submit" className="btn primary" disabled={saving}>
            {saving && <Spinner />}
            {saving ? 'Guardando…' : 'Añadir precio'}
          </button>
        </>
      }
    >
      <div>
        {current ? (
          <>
            <p className="detail-price num">
              <strong>{formatMoney(current.price, current.currency)}</strong>
              {other && <span className="muted"> ≈ {formatMoney(other.amount, other.currency)}</span>}
            </p>
            <p className="small muted">
              {asset.ticker ? `${asset.ticker} · ` : ''}
              {priceNote(current)}
              {change && (
                <span className={change.abs.isNeg() ? 'loss' : 'gain'}> · {formatPercent(change.pct)} en el día</span>
              )}
            </p>
          </>
        ) : (
          <p className="muted">Todavía no tiene precio. Añade el primero abajo.</p>
        )}
      </div>

      <PriceChart points={series} />
      {series.length < 2 && current && (
        <p className="small muted">
          El gráfico aparece cuando hay al menos dos precios en días distintos. Añade uno nuevo cada vez que lo consultes.
        </p>
      )}

      <div className="grid-2">
        <Field label="Fecha del precio">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={tried && !dateOk} />
        </Field>
        <Field label="Divisa">
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {options.map((c) => (
              <option key={c} value={c}>
                {c === 'EUR' ? 'Euros (€)' : c === 'USD' ? 'Dólares ($)' : c}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        label="Precio"
        hint={
          tried && !priceOk
            ? 'Escribe un precio mayor que cero, p. ej. 12,34'
            : 'Si ya hay uno de esa fecha, se corrige. Se guarda con el cambio del BCE de ese día.'
        }
      >
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="12,34" aria-invalid={tried && !priceOk} />
      </Field>

      {live.length > 0 && (
        <section>
          <h3 className="list-title">Precios que has puesto</h3>
          <ul className="rows">
            {live.map((p) => {
              const eur =
                p.fxRate && p.currency !== 'EUR' ? new Decimal(p.price).div(p.fxRate) : priceToEur(new Decimal(p.price), p.currency, fx)
              return (
                <li key={p.id}>
                  <div className="row">
                    <span className="row-title">{dateFmt.format(new Date(p.date + 'T12:00:00'))}</span>
                    <span className="row-end num">
                      <strong>{formatMoney(p.price, p.currency)}</strong>
                    </span>
                    <span className="row-sub num">{p.currency !== 'EUR' && eur ? `≈ ${formatMoney(eur, 'EUR')}${p.fxRate ? ' al cambio de ese día' : ''}` : ''}</span>
                    <span className="row-end">
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={saving}
                        onClick={() => {
                          if (confirm(`¿Borrar el precio del ${dateFmt.format(new Date(p.date + 'T12:00:00'))}?`))
                            void deletePricePoint(p.id)
                        }}
                      >
                        Borrar
                      </button>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </Sheet>
  )
}
