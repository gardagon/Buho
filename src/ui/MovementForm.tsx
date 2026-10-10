import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../data/db'
import { deleteMovement, saveMovement } from '../data/repo'
import { checkTradePrice } from '../domain/checks'
import { Decimal, d, formatMoney, formatQuantity, parseUserNumber, toInputValue } from '../domain/numbers'
import { computePortfolio, toEur } from '../domain/portfolio'
import { completeTrade } from '../domain/trade'
import { fetchRateOn } from '../quotes/fx'
import { MOVEMENT_TYPES, isTrade, type Asset, type Movement, type MovementType } from '../domain/types'
import { AssetForm } from './AssetForm'
import { Field, Sheet } from './Sheet'
import { Spinner } from './Spinner'
import { useToast } from './Toast'

interface Props {
  movement?: Movement
  assets: Asset[]
  movements: Movement[]
  defaultAssetId?: string
  onClose: () => void
}

const ADDED: Record<MovementType, string> = {
  compra: 'Compra añadida',
  venta: 'Venta añadida',
  dividendo: 'Dividendo añadido',
  cupon: 'Cupón añadido',
}

const KIND: Record<MovementType, { noun: string; article: 'Nueva' | 'Nuevo' }> = {
  compra: { noun: 'compra', article: 'Nueva' },
  venta: { noun: 'venta', article: 'Nueva' },
  dividendo: { noun: 'dividendo', article: 'Nuevo' },
  cupon: { noun: 'cupón', article: 'Nuevo' },
}

const dayFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })

const today = () => {
  const n = new Date()
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function MovementForm({ movement, assets, movements, defaultAssetId, onClose }: Props) {
  const toast = useToast()
  const [assetId, setAssetId] = useState(movement?.assetId ?? defaultAssetId ?? assets[0]?.id ?? '')
  const [type, setType] = useState<MovementType>(movement?.type ?? 'compra')
  const [date, setDate] = useState(movement?.date ?? today())
  const [quantity, setQuantity] = useState(toInputValue(movement?.quantity))
  const [price, setPrice] = useState(toInputValue(movement?.price))
  const [amount, setAmount] = useState(toInputValue(movement?.amount))
  // En compras y ventas las comisiones y el total van en EUR (lo que cobra el bróker);
  // en dividendos y cupones, en la divisa del movimiento.
  const [fees, setFees] = useState(() => {
    if (!movement || movement.fees === '0') return ''
    if (!isTrade(movement.type)) return toInputValue(movement.fees)
    return toInputValue(toEur(d(movement.fees), movement.fxRate).toDecimalPlaces(4).toString())
  })
  const [totalPaid, setTotalPaid] = useState(toInputValue(movement?.totalEur))
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(movement?.currency ?? null)
  const [withholding, setWithholding] = useState(
    movement && movement.withholding !== '0' ? toInputValue(movement.withholding) : '',
  )
  const [fxRate, setFxRate] = useState(movement && movement.fxRate !== '1' ? toInputValue(movement.fxRate) : '')
  const [account, setAccount] = useState(movement?.account ?? '')
  const [note, setNote] = useState(movement?.note ?? '')
  const [tried, setTried] = useState(false)
  const [creatingAsset, setCreatingAsset] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ecb, setEcb] = useState<{ key: string; rate: string; date: string } | null>(null)

  const asset = assets.find((a) => a.id === assetId)
  const currency = currencyChoice ?? asset?.currency ?? 'EUR'
  const currencyOptions = [...new Set([asset?.currency ?? 'EUR', 'EUR', 'USD'])]
  const needsFx = currency !== 'EUR'
  const trade = isTrade(type)

  // Cambio del BCE del día del movimiento (Frankfurter): se usa si no se escribe uno.
  useEffect(() => {
    if (!needsFx || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    let cancelled = false
    fetchRateOn(currency, date).then(
      (r) => !cancelled && setEcb({ key: `${currency}|${date}`, ...r }),
      () => {}, // sin conexión: se calcula el cambio efectivo con el total, o se escribe a mano
    )
    return () => {
      cancelled = true
    }
  }, [needsFx, currency, date])
  const ecbNow = ecb && ecb.key === `${currency}|${date}` ? ecb : null

  const accounts = useMemo(
    () => [...new Set(movements.map((m) => m.account).filter(Boolean) as string[])].sort(),
    [movements],
  )

  // Títulos disponibles para vender, sin contar este mismo movimiento.
  const available = useMemo(() => {
    if (type !== 'venta' || !asset) return null
    const others = movements.filter((m) => m.id !== movement?.id && m.assetId === asset.id && m.date <= date)
    const p = computePortfolio([asset], others)
    return p.positions[0]?.quantity ?? d(0)
  }, [type, asset, movements, movement?.id, date])

  const q = parseUserNumber(quantity)
  const pr = price.trim() === '' ? undefined : parseUserNumber(price)
  const am = parseUserNumber(amount)
  const feesRaw = fees.trim() === '' ? undefined : parseUserNumber(fees)
  const totalRaw = totalPaid.trim() === '' ? undefined : parseUserNumber(totalPaid)
  const fe = feesRaw === undefined ? '0' : feesRaw
  const wh = withholding.trim() === '' ? '0' : parseUserNumber(withholding)
  const fxRaw = fxRate.trim() === '' ? undefined : parseUserNumber(fxRate)

  // Compras y ventas: lo que falta se calcula con lo que sí se ha puesto.
  const t = trade
    ? completeTrade({
        type: type as 'compra' | 'venta',
        currency,
        quantity: q ? d(q) : undefined,
        price: pr ? d(pr) : undefined,
        fxRate: fxRaw ? d(fxRaw) : ecbNow ? d(ecbNow.rate) : undefined,
        feesEur: feesRaw ? d(feesRaw) : undefined,
        totalEur: totalRaw ? d(totalRaw) : undefined,
      })
    : null
  // ¿El precio cuadra con lo que cotizó ese día? (con el histórico descargado)
  const day = useLiveQuery(
    () => (assetId && /^\d{4}-\d{2}-\d{2}$/.test(date) ? db.quoteDays.get([assetId, date]) : undefined),
    [assetId, date],
  )
  const check =
    trade && t?.price ? checkTradePrice({ type, price: t.price.toString(), currency } as Movement, day) : null

  const fx = trade ? (t!.fxRate ? t!.fxRate.toString() : null) : needsFx ? (fxRaw ?? ecbNow?.rate) : '1'

  const errors: Record<string, boolean> = {
    asset: !asset,
    date: !/^\d{4}-\d{2}-\d{2}$/.test(date),
    quantity: trade && (q === null || d(q).lte(0)),
    price: trade && (pr === null || !t!.price || t!.price.lt(0)),
    amount: !trade && (am === null || d(am).lte(0)),
    fees: feesRaw === null || (feesRaw !== undefined && d(feesRaw).lt(0)),
    total: trade && (totalRaw === null || (totalRaw !== undefined && d(totalRaw).lte(0)) || !!t!.inconsistent),
    withholding: wh === null || d(wh).lt(0),
    fx: fx === null || fx === undefined || d(fx).lte(0),
  }
  const valid = !Object.values(errors).some(Boolean)
  const bad = (k: string) => tried && errors[k]

  // Importe que ve la persona en el resumen.
  let total: string | null = null
  let totalEur: string | null = null
  if (valid && !trade) {
    const t2 = d(am).minus(d(wh)).minus(d(fe))
    total = formatMoney(t2, currency)
    if (needsFx) totalEur = formatMoney(toEur(t2, fx!), 'EUR')
  }
  const totalLabel = type === 'compra' ? 'Total pagado' : type === 'venta' ? 'Total recibido' : 'Neto cobrado'
  /** Número calculado como texto para un campo vacío (coma decimal). */
  const calc = (v: Decimal | undefined, dp: number) => (v ? toInputValue(v.toDecimalPlaces(dp).toString()) : undefined)

  async function submit() {
    setTried(true)
    if (!valid || !asset || saving) return
    setSaving(true)
    // Las comisiones se piden en EUR; se guardan en la divisa del movimiento.
    const feesStored = trade ? (t!.feesEur ?? d(0)).mul(d(fx!)).toDecimalPlaces(8).toString() : fe!
    try {
      await saveMovement(
        {
          assetId: asset.id,
          type,
          date,
          quantity: trade ? q! : undefined,
          price: trade ? t!.price!.toString() : undefined,
          amount: trade ? undefined : am!,
          currency,
          fxRate: fx!,
          fees: feesStored,
          // Solo si la persona lo ha puesto: es lo que realmente cobró o ingresó el bróker.
          totalEur: trade && totalRaw ? totalRaw : undefined,
          withholding: trade ? '0' : wh!,
          account: account.trim() || undefined,
          note: note.trim() || undefined,
        },
        movement?.id,
      )
    } catch (e) {
      setSaving(false)
      toast(`No se pudo guardar el movimiento: ${e instanceof Error ? e.message : 'error desconocido'}. Inténtalo de nuevo.`)
      return
    }
    toast(movement ? 'Movimiento guardado' : ADDED[type])
    onClose()
  }

  async function remove() {
    if (!movement || saving || !confirm('¿Eliminar este movimiento?')) return
    setSaving(true)
    try {
      await deleteMovement(movement.id)
    } catch {
      setSaving(false)
      toast('No se pudo eliminar el movimiento. Inténtalo de nuevo.')
      return
    }
    toast('Movimiento eliminado')
    onClose()
  }

  if (creatingAsset) {
    return (
      <AssetForm
        onClose={(id) => {
          if (id) setAssetId(id)
          setCreatingAsset(false)
        }}
      />
    )
  }

  return (
    <Sheet
      title={movement ? `Editar ${KIND[type].noun}` : `${KIND[type].article} ${KIND[type].noun}`}
      tone={type}
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          {movement && (
            <button type="button" className="btn danger" onClick={remove} disabled={saving}>
              Eliminar
            </button>
          )}
          <span className="spacer" />
          <button type="submit" className="btn primary" disabled={saving}>
            {saving && <Spinner />}
            {saving ? 'Guardando…' : movement ? `Guardar ${KIND[type].noun}` : `Añadir ${KIND[type].noun}`}
          </button>
        </>
      }
    >
      <div className="segmented" role="radiogroup" aria-label="Tipo de movimiento">
        {(Object.keys(MOVEMENT_TYPES) as MovementType[]).map((t) => (
          <label key={t} data-tone={t}>
            <input type="radio" name="type" value={t} checked={type === t} onChange={() => {
                if (isTrade(t) !== isTrade(type)) {
                  setFees('')
                  setTotalPaid('')
                }
                setType(t)
              }} />
            <span>{MOVEMENT_TYPES[t]}</span>
          </label>
        ))}
      </div>

      <Field
        label="Activo"
        hint={
          <button type="button" className="btn ghost small" style={{ padding: 0 }} onClick={() => setCreatingAsset(true)}>
            Añadir un activo nuevo
          </button>
        }
      >
        <select value={assetId} onChange={(e) => {
            setAssetId(e.target.value)
            setCurrencyChoice(null)
          }} aria-invalid={bad('asset')}>
          {!asset && <option value="">Elige un activo</option>}
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.ticker ? ` (${a.ticker})` : ''}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Fecha">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={bad('date')} />
      </Field>

      {trade ? (
        <>
          <div className="grid-2">
            <Field
              label="Cantidad"
              hint={available ? `Tienes ${formatQuantity(available)} en esa fecha` : 'Títulos o participaciones'}
            >
              <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={bad('quantity')} />
            </Field>
            <Field label="Precio por título" hint={t?.derived.price ? 'Calculado con el total' : undefined}>
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={calc(t?.price, 6)}
                aria-invalid={bad('price')}
              />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Divisa del precio" hint="La que ves en tu bróker">
              <select value={currency} onChange={(e) => setCurrencyChoice(e.target.value)}>
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c === 'EUR' ? 'Euros (€)' : c === 'USD' ? 'Dólares ($)' : c}
                  </option>
                ))}
              </select>
            </Field>
            {needsFx && (
              <Field
                label="Tipo de cambio"
                hint={
                  fxRaw
                    ? `${currency} por 1 EUR`
                    : ecbNow
                      ? `Del BCE (${dayFmt.format(new Date(ecbNow.date + 'T12:00:00'))}). Puedes escribir el de tu bróker.`
                      : t?.derived.fxRate
                        ? 'Calculado: incluye comisiones'
                        : `${currency} por 1 EUR`
                }
              >
                <input
                  inputMode="decimal"
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  placeholder={ecbNow ? toInputValue(ecbNow.rate) : (calc(t?.derived.fxRate ? t.fxRate : undefined, 6) ?? '1,0850')}
                  aria-invalid={bad('fx')}
                />
              </Field>
            )}
          </div>
          <div className="grid-2">
            <Field
              label="Comisiones (€)"
              hint={t?.derived.feesEur ? 'Calculadas con el total' : 'Cánones y gastos'}
            >
              <input
                inputMode="decimal"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                placeholder={calc(t?.derived.feesEur ? t.feesEur : undefined, 2) ?? '0'}
                aria-invalid={bad('fees')}
              />
            </Field>
            <Field
              label={`${totalLabel} (€)`}
              hint={t?.derived.totalEur ? 'Calculado' : type === 'compra' ? 'Lo que te cobraron' : 'Lo que te ingresaron'}
            >
              <input
                inputMode="decimal"
                value={totalPaid}
                onChange={(e) => setTotalPaid(e.target.value)}
                placeholder={calc(t?.derived.totalEur ? t.totalEur : undefined, 2)}
                aria-invalid={bad('total')}
              />
            </Field>
          </div>
        </>
      ) : (
        <>
          <div className="grid-2">
            <Field label={`Importe bruto (${currency})`}>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={bad('amount')} />
            </Field>
            <Field label={`Retención (${currency})`} hint="Origen y destino">
              <input inputMode="decimal" value={withholding} onChange={(e) => setWithholding(e.target.value)} placeholder="0" aria-invalid={bad('withholding')} />
            </Field>
          </div>
          <div className="grid-2">
            <Field
              label="Divisa del importe"
              hint={
                asset && currency !== asset.currency
                  ? `Aunque el valor cotice en ${asset.currency}, aquí lo apuntas en ${currency}.`
                  : 'La moneda en la que te lo pagan'
              }
            >
              <select value={currency} onChange={(e) => setCurrencyChoice(e.target.value)}>
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c === 'EUR' ? 'Euros (€)' : c === 'USD' ? 'Dólares ($)' : c}
                  </option>
                ))}
              </select>
            </Field>
            {needsFx && (
              <Field
                label="Tipo de cambio"
                hint={ecbNow && !fxRaw ? `Del BCE (${dayFmt.format(new Date(ecbNow.date + 'T12:00:00'))})` : `${currency} por 1 EUR ese día`}
              >
                <input
                  inputMode="decimal"
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  placeholder={ecbNow ? toInputValue(ecbNow.rate) : '1,0850'}
                  aria-invalid={bad('fx')}
                />
              </Field>
            )}
          </div>
          <div className="grid-2">
            <Field label={`Comisiones (${currency})`} hint="Incluye cánones y gastos">
              <input inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" aria-invalid={bad('fees')} />
            </Field>
          </div>
        </>
      )}

      {trade && t?.totalEur && t.perShareEur && !t.inconsistent && (
        <div className="total-line num">
          <span>{type === 'compra' ? 'Precio medio real' : 'Neto por título'}</span>
          <strong>
            {formatMoney(t.perShareEur, 'EUR')}
            <span className="muted"> · comisiones incluidas</span>
          </strong>
        </div>
      )}
      {check?.status === 'fuera' && (
        <p className="notice small" role="status">
          El {dayFmt.format(new Date(date + 'T12:00:00'))} cotizó entre {formatMoney(check.low!, check.currency)} y{' '}
          {formatMoney(check.high!, check.currency)}. Revisa el precio, la divisa o la fecha (también puede ser un split posterior).
        </p>
      )}
      {trade && t?.inconsistent && (
        <p className="error-text">
          {type === 'compra'
            ? 'El total pagado es menor que cantidad × precio. Revisa el precio, la divisa o el tipo de cambio.'
            : 'El total recibido es mayor que cantidad × precio. Revisa el precio, la divisa o el tipo de cambio.'}
        </p>
      )}
      {trade && t?.mismatchEur && !t.inconsistent && (
        <p className="small muted">
          Los datos no cuadran por {formatMoney(t.mismatchEur.abs(), 'EUR')}. Se guardará el total que has puesto, que es el importe real.
        </p>
      )}
      {total && (
        <div className="total-line num">
          <span>{totalLabel}</span>
          <strong>
            {total}
            {totalEur && <span className="muted"> ({totalEur})</span>}
          </strong>
        </div>
      )}
      {type === 'venta' && available && q && d(q).gt(available) && (
        <p className="error-text">Vendes más títulos de los que tenías en esa fecha. Revisa la cantidad o añade antes la compra.</p>
      )}

      <Field label="Cuenta o bróker">
        <input list="accounts" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="MyInvestor, Interactive Brokers…" />
        <datalist id="accounts">
          {accounts.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </Field>
      <Field label="Notas">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {tried && !valid && <p className="error-text">Revisa los campos marcados en rojo.</p>}
    </Sheet>
  )
}
