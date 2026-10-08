import { useMemo, useState } from 'react'
import { deleteMovement, saveMovement } from '../data/repo'
import { d, formatMoney, formatQuantity, parseUserNumber, toInputValue } from '../domain/numbers'
import { computePortfolio, toEur } from '../domain/portfolio'
import { MOVEMENT_TYPES, isTrade, type Asset, type Movement, type MovementType } from '../domain/types'
import { AssetForm } from './AssetForm'
import { Field, Sheet } from './Sheet'
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
  const [fees, setFees] = useState(movement && movement.fees !== '0' ? toInputValue(movement.fees) : '')
  const [withholding, setWithholding] = useState(
    movement && movement.withholding !== '0' ? toInputValue(movement.withholding) : '',
  )
  const [fxRate, setFxRate] = useState(movement && movement.fxRate !== '1' ? toInputValue(movement.fxRate) : '')
  const [account, setAccount] = useState(movement?.account ?? '')
  const [note, setNote] = useState(movement?.note ?? '')
  const [tried, setTried] = useState(false)
  const [creatingAsset, setCreatingAsset] = useState(false)

  const asset = assets.find((a) => a.id === assetId)
  const currency = movement?.assetId === assetId ? movement.currency : (asset?.currency ?? 'EUR')
  const needsFx = currency !== 'EUR'
  const trade = isTrade(type)

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
  const pr = parseUserNumber(price)
  const am = parseUserNumber(amount)
  const fe = fees.trim() === '' ? '0' : parseUserNumber(fees)
  const wh = withholding.trim() === '' ? '0' : parseUserNumber(withholding)
  const fx = !needsFx ? '1' : parseUserNumber(fxRate)

  const errors: Record<string, boolean> = {
    asset: !asset,
    date: !/^\d{4}-\d{2}-\d{2}$/.test(date),
    quantity: trade && (q === null || d(q).lte(0)),
    price: trade && (pr === null || d(pr).lt(0)),
    amount: !trade && (am === null || d(am).lte(0)),
    fees: fe === null || d(fe).lt(0),
    withholding: wh === null || d(wh).lt(0),
    fx: fx === null || d(fx).lte(0),
  }
  const valid = !Object.values(errors).some(Boolean)
  const bad = (k: string) => tried && errors[k]

  let total: string | null = null
  let totalEur: string | null = null
  if (valid) {
    const t =
      type === 'compra'
        ? d(q).mul(d(pr)).plus(d(fe))
        : type === 'venta'
          ? d(q).mul(d(pr)).minus(d(fe))
          : d(am).minus(d(wh)).minus(d(fe))
    total = formatMoney(t, currency)
    if (needsFx) totalEur = formatMoney(toEur(t, fx!), 'EUR')
  }
  const totalLabel = type === 'compra' ? 'Coste total' : type === 'venta' ? 'Importe neto' : 'Neto cobrado'

  async function submit() {
    setTried(true)
    if (!valid || !asset) return
    await saveMovement(
      {
        assetId: asset.id,
        type,
        date,
        quantity: trade ? q! : undefined,
        price: trade ? pr! : undefined,
        amount: trade ? undefined : am!,
        currency,
        fxRate: fx!,
        fees: fe!,
        withholding: trade ? '0' : wh!,
        account: account.trim() || undefined,
        note: note.trim() || undefined,
      },
      movement?.id,
    )
    toast(movement ? 'Movimiento guardado' : ADDED[type])
    onClose()
  }

  async function remove() {
    if (!movement || !confirm('¿Eliminar este movimiento?')) return
    await deleteMovement(movement.id)
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
      title={movement ? 'Editar movimiento' : 'Nuevo movimiento'}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          {movement && (
            <button type="button" className="btn danger" onClick={remove}>
              Eliminar
            </button>
          )}
          <span className="spacer" />
          <button type="submit" className="btn primary">
            {movement ? 'Guardar movimiento' : 'Añadir movimiento'}
          </button>
        </>
      }
    >
      <div className="segmented" role="radiogroup" aria-label="Tipo de movimiento">
        {(Object.keys(MOVEMENT_TYPES) as MovementType[]).map((t) => (
          <label key={t}>
            <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} />
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
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} aria-invalid={bad('asset')}>
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
        <div className="grid-2">
          <Field
            label="Cantidad"
            hint={available ? `Tienes ${formatQuantity(available)} en esa fecha` : 'Títulos o participaciones'}
          >
            <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={bad('quantity')} />
          </Field>
          <Field label={`Precio (${currency})`} hint="Por título">
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={bad('price')} />
          </Field>
        </div>
      ) : (
        <div className="grid-2">
          <Field label={`Importe bruto (${currency})`}>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={bad('amount')} />
          </Field>
          <Field label={`Retención (${currency})`} hint="Origen y destino">
            <input inputMode="decimal" value={withholding} onChange={(e) => setWithholding(e.target.value)} placeholder="0" aria-invalid={bad('withholding')} />
          </Field>
        </div>
      )}

      <div className="grid-2">
        <Field label={`Comisiones (${currency})`} hint="Incluye cánones y gastos">
          <input inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" aria-invalid={bad('fees')} />
        </Field>
        {needsFx && (
          <Field label="Tipo de cambio" hint={`${currency} por 1 EUR ese día`}>
            <input inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="1,0850" aria-invalid={bad('fx')} />
          </Field>
        )}
      </div>

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
