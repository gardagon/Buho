import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../data/db'
import { deleteMovement, saveMovement } from '../data/repo'
import { checkTradePrice } from '../domain/checks'
import { Decimal, d, formatMoney, formatQuantity, parseUserNumber, toInputValue } from '../domain/numbers'
import { impliedIncomeFx, incomeBreakdown } from '../domain/income'
import { computePortfolio, toEur } from '../domain/portfolio'
import { completeTrade } from '../domain/trade'
import { fetchRateOn } from '../quotes/fx'
import { MOVEMENT_TYPES, isTrade, type Asset, type Movement, type MovementType } from '../domain/types'
import { AssetForm } from './AssetForm'
import { windowsHitBy } from './LossWindows'
import type { LossWindow } from '../domain/twoMonths'
import { Field, Sheet } from './Sheet'
import { Spinner } from './Spinner'
import { useToast } from './Toast'

interface Props {
  /** Ventas con pérdida y su ventana de recompra (regla de los dos meses). */
  lossWindows: LossWindow[]
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
  traspaso: 'Traspaso añadido',
}

const KIND: Record<MovementType, { noun: string; article: 'Nueva' | 'Nuevo' }> = {
  compra: { noun: 'compra', article: 'Nueva' },
  venta: { noun: 'venta', article: 'Nueva' },
  dividendo: { noun: 'dividendo', article: 'Nuevo' },
  cupon: { noun: 'cupón', article: 'Nuevo' },
  traspaso: { noun: 'traspaso', article: 'Nuevo' },
}

/** Suma de dos importes escritos por la persona, o null si alguno no es un número. */
const sumInputs = (a: string, b: string) => {
  const x = a.trim() === '' ? '0' : parseUserNumber(a)
  const y = b.trim() === '' ? '0' : parseUserNumber(b)
  return x === null || y === null ? null : d(x).plus(d(y))
}

const dayFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })

const today = () => {
  const n = new Date()
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function MovementForm({ lossWindows, movement, assets, movements, defaultAssetId, onClose }: Props) {
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
  // Impuestos de la operación (p. ej. la tasa sobre transacciones financieras), en EUR como las comisiones.
  const [taxes, setTaxes] = useState(() => {
    if (!movement?.taxes || movement.taxes === '0') return ''
    return toInputValue(toEur(d(movement.taxes), movement.fxRate).toDecimalPlaces(4).toString())
  })
  const [totalPaid, setTotalPaid] = useState(toInputValue(movement?.totalEur))
  // Al editar, el total guardado manda sobre el cálculo: si cambias cantidad, precio, cambio o comisiones sin tocar
  // el total, se recalcula en vez de dejar el antiguo (que haría que el cambio no se notara en el coste).
  const [totalTouched, setTotalTouched] = useState(false)
  // Valores al abrir: si no cambian cantidad, precio, cambio ni la suma de comisiones e impuestos, el total guardado sigue valiendo.
  const [initial] = useState(() => ({ quantity, price, fxRate: movement && movement.fxRate !== '1' ? toInputValue(movement.fxRate) : '', extras: sumInputs(fees, taxes) }))
  // Traspaso entre fondos: fondo de destino y participaciones que recibe.
  const [toAssetId, setToAssetId] = useState(movement?.toAssetId ?? '')
  const [toQuantity, setToQuantity] = useState(toInputValue(movement?.toQuantity))
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(movement?.currency ?? null)
  // Dividendos y cupones: retención en origen y en España, cada una con su divisa, y el neto real ingresado.
  const hadSplit = movement?.withholdingOrigin !== undefined || movement?.withholdingDest !== undefined
  const [whOrigin, setWhOrigin] = useState(movement?.withholdingOrigin && movement.withholdingOrigin !== '0' ? toInputValue(movement.withholdingOrigin) : '')
  const [whOriginCur, setWhOriginCur] = useState<string | null>(movement?.withholdingOriginCurrency ?? null)
  const [whDest, setWhDest] = useState(movement?.withholdingDest && movement.withholdingDest !== '0' ? toInputValue(movement.withholdingDest) : '')
  const [whDestCur, setWhDestCur] = useState<string | null>(movement?.withholdingDestCurrency ?? null)
  // Retención de un movimiento anterior a la separación: se conserva hasta que se reparta entre origen y España.
  const [withholding, setWithholding] = useState(
    movement && !hadSplit && movement.withholding !== '0' ? toInputValue(movement.withholding) : '',
  )
  const [netPaid, setNetPaid] = useState(toInputValue(movement?.netEur))
  const [netTouched, setNetTouched] = useState(false)
  const [fxRate, setFxRate] = useState(movement && movement.fxRate !== '1' ? toInputValue(movement.fxRate) : '')
  const [account, setAccount] = useState(movement?.account ?? '')
  const [note, setNote] = useState(movement?.note ?? '')
  const [tried, setTried] = useState(false)
  const [creatingAsset, setCreatingAsset] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ecb, setEcb] = useState<{ key: string; rate: string; date: string } | null>(null)

  const asset = assets.find((a) => a.id === assetId)
  const transfer = type === 'traspaso'
  const currency = transfer ? 'EUR' : (currencyChoice ?? asset?.currency ?? 'EUR')
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
    if ((type !== 'venta' && type !== 'traspaso') || !asset) return null
    const others = movements.filter((m) => m.id !== movement?.id && m.assetId === asset.id && m.date <= date)
    const p = computePortfolio([asset], others)
    return p.positions[0]?.quantity ?? d(0)
  }, [type, asset, movements, movement?.id, date])

  const q = parseUserNumber(quantity)
  const pr = price.trim() === '' ? undefined : parseUserNumber(price)
  const am = parseUserNumber(amount)
  const toQ = toQuantity.trim() === '' ? undefined : parseUserNumber(toQuantity)
  const feesRaw = fees.trim() === '' ? undefined : parseUserNumber(fees)
  const taxesRaw = taxes.trim() === '' ? undefined : parseUserNumber(taxes)
  // Editando: si cambia algo de lo que sale el total y no se ha tocado el total, se recalcula en vez de dejar el antiguo.
  const extrasNow = sumInputs(fees, taxes)
  const totalStale =
    !!movement && trade && !totalTouched &&
    (quantity !== initial.quantity || price !== initial.price || fxRate !== initial.fxRate || !(extrasNow && initial.extras && extrasNow.eq(initial.extras)))
  const totalRaw = totalStale || totalPaid.trim() === '' ? undefined : parseUserNumber(totalPaid)
  const fe = feesRaw === undefined ? '0' : feesRaw
  const wh = withholding.trim() === '' ? '0' : parseUserNumber(withholding)
  const whO = whOrigin.trim() === '' ? undefined : parseUserNumber(whOrigin)
  const whD = whDest.trim() === '' ? undefined : parseUserNumber(whDest)
  const netRaw = netPaid.trim() === '' ? undefined : parseUserNumber(netPaid)
  const fxRaw = fxRate.trim() === '' ? undefined : parseUserNumber(fxRate)

  // Compras y ventas: lo que falta se calcula con lo que sí se ha puesto.
  const tradeInput = {
    type: type as 'compra' | 'venta',
    currency,
    quantity: q ? d(q) : undefined,
    price: pr ? d(pr) : undefined,
    feesEur: feesRaw ? d(feesRaw) : undefined,
    taxesEur: taxesRaw ? d(taxesRaw) : undefined,
    totalEur: totalRaw ? d(totalRaw) : undefined,
  }
  // Operación en divisa con el total y las comisiones puestos: el cambio efectivo es el que cuadra con lo que cobró el
  // bróker (el del BCE rara vez coincide, y escribirlo a mano con pocos decimales descuadra unos céntimos).
  const impliedTrade =
    trade && needsFx && totalRaw && (feesRaw !== undefined || taxesRaw !== undefined)
      ? completeTrade({ ...tradeInput, fxRate: undefined })
      : null
  const impliedTradeFx = impliedTrade?.derived.fxRate ? impliedTrade.fxRate : undefined
  const t = trade
    ? completeTrade({
        ...tradeInput,
        fxRate: fxRaw ? d(fxRaw) : (impliedTradeFx ?? (ecbNow ? d(ecbNow.rate) : undefined)),
      })
    : null
  // ¿El precio cuadra con lo que cotizó ese día? (con el histórico descargado)
  const day = useLiveQuery(
    () => (assetId && /^\d{4}-\d{2}-\d{2}$/.test(date) ? db.quoteDays.get([assetId, date]) : undefined),
    [assetId, date],
  )
  const check =
    trade && t?.price ? checkTradePrice({ type, price: t.price.toString(), currency } as Movement, day) : null

  // Dividendo en divisa con el neto real puesto y sin cambio escrito: el cambio que explica lo que ingresó el bróker.
  const splitNow = whOrigin.trim() !== '' || whDest.trim() !== ''
  const impliedFx =
    !trade && !transfer && needsFx && netRaw && am && fe !== null && wh !== null && whO !== null && whD !== null
      ? impliedIncomeFx({
          amount: d(am),
          fees: d(fe),
          currency,
          netEur: d(netRaw),
          withholdings: splitNow
            ? [
                ...(whO ? [{ amount: d(whO), currency: whOriginCur ?? currency }] : []),
                ...(whD ? [{ amount: d(whD), currency: whDestCur ?? currency }] : []),
              ]
            : [{ amount: d(wh), currency }],
        })
      : undefined
  // Con un cambio escrito a mano, manda ese; si no, el que explica el neto.
  const derivedFx = fxRaw === undefined ? impliedFx : undefined
  const fx = transfer ? '1' : trade ? (t!.fxRate ? t!.fxRate.toString() : null) : needsFx ? (fxRaw ?? derivedFx?.toString() ?? ecbNow?.rate) : '1'

  const errors: Record<string, boolean> = {
    asset: !asset,
    date: !/^\d{4}-\d{2}-\d{2}$/.test(date),
    quantity: (trade || transfer) && (q === null || d(q).lte(0)),
    toAsset: transfer && (!toAssetId || toAssetId === assetId || !assets.some((a) => a.id === toAssetId)),
    toQuantity: transfer && (toQ === undefined || toQ === null || d(toQ).lte(0)),
    price: trade && (pr === null || !t!.price || t!.price.lt(0)),
    amount: !trade && !transfer && (am === null || d(am).lte(0)),
    fees: feesRaw === null || (feesRaw !== undefined && d(feesRaw).lt(0)),
    taxes: taxesRaw === null || (taxesRaw !== undefined && d(taxesRaw).lt(0)),
    total: trade && (totalRaw === null || (totalRaw !== undefined && d(totalRaw).lte(0)) || !!t!.inconsistent),
    withholding: wh === null || d(wh).lt(0),
    whOrigin: whO === null || (whO !== undefined && d(whO).lt(0)),
    whDest: whD === null || (whD !== undefined && d(whD).lt(0)),
    net: netRaw === null || (netRaw !== undefined && d(netRaw).lte(0)),
    fx: fx === null || fx === undefined || d(fx).lte(0),
  }
  const valid = !Object.values(errors).some(Boolean)
  const bad = (k: string) => tried && errors[k]

  // Importe que ve la persona en el resumen.
  let total: string | null = null
  let totalEur: string | null = null
  // Dividendos y cupones: el cálculo es el mismo que se usa en toda la app.
  const split = whOrigin.trim() !== '' || whDest.trim() !== ''
  const draft: Movement | null =
    valid && !trade && !transfer
      ? {
          id: '', createdAt: '', updatedAt: '', assetId, type, date, amount: am!, currency, fxRate: fx!, fees: fe!,
          withholding: split ? '0' : wh!,
          ...(split
            ? {
                withholdingOrigin: whO ?? '0', withholdingOriginCurrency: whOriginCur ?? currency,
                withholdingDest: whD ?? '0', withholdingDestCurrency: whDestCur ?? currency,
              }
            : {}),
          netEur: netRaw ?? undefined,
        }
      : null
  const income = draft ? incomeBreakdown(draft) : null
  if (income) {
    total = formatMoney(income.netEur, 'EUR')
  }
  const totalLabel = type === 'compra' ? 'Total pagado' : type === 'venta' ? 'Total recibido' : 'Neto cobrado'
  const currencyName = (c: string) => (c === 'EUR' ? 'Euros (€)' : c === 'USD' ? 'Dólares ($)' : c)
  const withholdingCurrencies = [...new Set([currency, 'EUR'])]
  /** Como en compras y ventas: si cambia un dato del que sale el neto y no se ha tocado el neto, se recalcula. */
  function editIncome(set: (v: string) => void, value: string) {
    set(value)
    if (movement && !trade && !netTouched) setNetPaid('')
  }
  const edit = (set: (v: string) => void, value: string) => set(value)
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
        transfer
          ? {
              assetId: asset.id,
              type,
              date,
              quantity: q!,
              toAssetId,
              toQuantity: toQ!,
              currency: 'EUR',
              fxRate: '1',
              fees: '0',
              withholding: '0',
              account: account.trim() || undefined,
              note: note.trim() || undefined,
            }
          : {
          assetId: asset.id,
          type,
          date,
          quantity: trade ? q! : undefined,
          price: trade ? t!.price!.toString() : undefined,
          amount: trade ? undefined : am!,
          currency,
          fxRate: fx!,
          fees: feesStored,
          // Impuestos de la operación, también en la divisa del movimiento (como las comisiones).
          taxes: trade && t!.taxesEur && !t!.taxesEur.isZero() ? t!.taxesEur.mul(d(fx!)).toDecimalPlaces(8).toString() : undefined,
          // Solo si la persona lo ha puesto: es lo que realmente cobró o ingresó el bróker.
          totalEur: trade && totalRaw ? totalRaw : undefined,
          // Con retenciones separadas, la total se guarda también (en la divisa del movimiento) para versiones anteriores.
          withholding: trade ? '0' : split ? income!.withholdingEur.mul(d(fx!)).toDecimalPlaces(8).toString() : wh!,
          ...(!trade && split
            ? {
                withholdingOrigin: whO ?? '0',
                withholdingOriginCurrency: whOriginCur ?? currency,
                withholdingDest: whD ?? '0',
                withholdingDestCurrency: whDestCur ?? currency,
              }
            : {}),
          netEur: !trade && netRaw ? netRaw : undefined,
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
                  setTaxes('')
                  setTotalPaid('')
                }
                setType(t)
              }} />
            <span>{MOVEMENT_TYPES[t]}</span>
          </label>
        ))}
      </div>

      <Field
        label={transfer ? 'Fondo de origen' : 'Activo'}
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

      {transfer && (
        <Field label="Fondo de destino" hint="Si no está, dalo de alta primero en Activos">
          <select value={toAssetId} onChange={(e) => setToAssetId(e.target.value)} aria-invalid={bad('toAsset')}>
            <option value="">Elige el fondo de destino</option>
            {assets
              .filter((a) => a.id !== assetId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.ticker ? ` (${a.ticker})` : ''}
                </option>
              ))}
          </select>
        </Field>
      )}

      <Field label="Fecha">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={bad('date')} />
      </Field>

      {transfer ? (
        <>
          <div className="grid-2">
            <Field label="Participaciones que salen" hint={available ? `Tienes ${formatQuantity(available)} en esa fecha` : undefined}>
              <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={bad('quantity')} />
            </Field>
            <Field label="Participaciones que entran" hint="Las que recibes en el fondo de destino">
              <input inputMode="decimal" value={toQuantity} onChange={(e) => setToQuantity(e.target.value)} aria-invalid={bad('toQuantity')} />
            </Field>
          </div>
          <p className="notice small" role="status">
            El traspaso no tributa: el fondo de destino hereda la fecha de compra y el coste de las participaciones que salen (art. 94 LIRPF).
            No es una venta, así que no genera plusvalía ni minusvalía.
          </p>
        </>
      ) : trade ? (
        <>
          <div className="grid-2">
            <Field
              label="Cantidad"
              hint={available ? `Tienes ${formatQuantity(available)} en esa fecha` : 'Títulos o participaciones'}
            >
              <input inputMode="decimal" value={quantity} onChange={(e) => edit(setQuantity, e.target.value)} aria-invalid={bad('quantity')} />
            </Field>
            <Field label="Precio por título" hint={t?.derived.price ? 'Calculado con el total' : undefined}>
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => edit(setPrice, e.target.value)}
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
                    : impliedTradeFx
                      ? 'Calculado con el total y las comisiones: el que explica lo que te cobraron'
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
                  onChange={(e) => edit(setFxRate, e.target.value)}
                  placeholder={impliedTradeFx ? calc(impliedTradeFx, 6) : ecbNow ? toInputValue(ecbNow.rate) : (calc(t?.derived.fxRate ? t.fxRate : undefined, 6) ?? '1,0850')}
                  aria-invalid={bad('fx')}
                />
              </Field>
            )}
          </div>
          <div className="grid-2">
            <Field
              label="Comisiones (€)"
              hint={t?.derived.feesEur ? 'Calculadas con el total' : 'Lo que cobra el bróker'}
            >
              <input
                inputMode="decimal"
                value={fees}
                onChange={(e) => edit(setFees, e.target.value)}
                placeholder={calc(t?.derived.feesEur ? t.feesEur : undefined, 2) ?? '0'}
                aria-invalid={bad('fees')}
              />
            </Field>
            <Field label="Impuestos (€)" hint="Tasa sobre transacciones financieras, timbre…">
              <input
                inputMode="decimal"
                value={taxes}
                onChange={(e) => edit(setTaxes, e.target.value)}
                placeholder="0"
                aria-invalid={bad('taxes')}
              />
            </Field>
          </div>
          <Field
            label={`${totalLabel} (€)`}
            hint={t?.derived.totalEur ? (movement?.totalEur && totalStale ? 'Recalculado con tus cambios' : 'Calculado') : type === 'compra' ? 'Lo que te cobraron' : 'Lo que te ingresaron'}
          >
            <input
              inputMode="decimal"
              value={totalStale ? '' : totalPaid}
              onChange={(e) => {
                setTotalTouched(true)
                setTotalPaid(e.target.value)
              }}
              placeholder={calc(t?.derived.totalEur ? t.totalEur : undefined, 2)}
              aria-invalid={bad('total')}
            />
          </Field>
        </>
      ) : (
        <>
          <div className="grid-2">
            <Field label={`Importe bruto (${currency})`} hint="Antes de retenciones">
              <input inputMode="decimal" value={amount} onChange={(e) => editIncome(setAmount, e.target.value)} aria-invalid={bad('amount')} />
            </Field>
            <Field
              label="Divisa del importe"
              hint={
                asset && currency !== asset.currency
                  ? `Aunque el valor cotice en ${asset.currency}, aquí lo apuntas en ${currency}.`
                  : 'La moneda en la que te lo pagan'
              }
            >
              <select value={currency} onChange={(e) => editIncome(setCurrencyChoice, e.target.value)}>
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {currencyName(c)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {needsFx && (
            <div className="grid-2">
              <Field
                label="Tipo de cambio"
                hint={
                  derivedFx
                    ? 'Calculado con el neto: el que explica lo que te ingresaron'
                    : ecbNow && !fxRaw
                      ? `Del BCE (${dayFmt.format(new Date(ecbNow.date + 'T12:00:00'))}). Escribe el de tu bróker si lo sabes, o el neto cobrado y se calcula.`
                      : `${currency} por 1 EUR ese día`
                }
              >
                <input
                  inputMode="decimal"
                  value={fxRate}
                  onChange={(e) => editIncome(setFxRate, e.target.value)}
                  placeholder={derivedFx ? toInputValue(derivedFx.toString()) : ecbNow ? toInputValue(ecbNow.rate) : '1,0850'}
                  aria-invalid={bad('fx')}
                />
              </Field>
            </div>
          )}
          <div className="grid-2">
            <Field label="Retención en origen" hint="La del país del valor (p. ej. EE. UU.)">
              <input inputMode="decimal" value={whOrigin} onChange={(e) => editIncome(setWhOrigin, e.target.value)} placeholder="0" aria-invalid={bad('whOrigin')} />
            </Field>
            <Field label="Divisa de esa retención">
              <select value={whOriginCur ?? currency} onChange={(e) => editIncome(setWhOriginCur, e.target.value)}>
                {withholdingCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {currencyName(c)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Retención en España" hint="La que practica el bróker en España">
              <input inputMode="decimal" value={whDest} onChange={(e) => editIncome(setWhDest, e.target.value)} placeholder="0" aria-invalid={bad('whDest')} />
            </Field>
            <Field label="Divisa de esa retención">
              <select value={whDestCur ?? currency} onChange={(e) => editIncome(setWhDestCur, e.target.value)}>
                {withholdingCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {currencyName(c)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {withholding.trim() !== '' && (
            <div className="grid-2">
              <Field label={`Retención sin repartir (${currency})`} hint="Apuntada antes de separar origen y España. Repártela arriba para la doble imposición.">
                <input inputMode="decimal" value={withholding} onChange={(e) => editIncome(setWithholding, e.target.value)} aria-invalid={bad('withholding')} />
              </Field>
            </div>
          )}
          <div className="grid-2">
            <Field label={`Comisiones (${currency})`} hint="Incluye cánones y gastos">
              <input inputMode="decimal" value={fees} onChange={(e) => editIncome(setFees, e.target.value)} placeholder="0" aria-invalid={bad('fees')} />
            </Field>
            <Field
              label="Neto cobrado (€)"
              hint={netRaw ? 'Lo que te ingresaron' : movement?.netEur && !netTouched ? 'Recalculado con tus cambios' : 'Calculado; escríbelo si tu bróker lo muestra'}
            >
              <input
                inputMode="decimal"
                value={netPaid}
                onChange={(e) => {
                  setNetTouched(true)
                  setNetPaid(e.target.value)
                }}
                placeholder={income && !netRaw ? toInputValue(income.netEur.toDecimalPlaces(2).toString()) : undefined}
                aria-invalid={bad('net')}
              />
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
      {type === 'compra' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        windowsHitBy(lossWindows, assetId, date).map((w) => (
          <p key={w.saleMovementId} className="notice small" role="status">
            Regla de los dos meses: vendiste {asset?.name} con {formatMoney(w.lossEur)} de pérdida el{' '}
            {dayFmt.format(new Date(w.saleDate + 'T12:00:00'))}. Comprar el {dayFmt.format(new Date(date + 'T12:00:00'))} hace que esa
            pérdida (o la parte proporcional) no compute hasta que vendas estos títulos. Para evitarlo, compra a partir del{' '}
            {dayFmt.format(new Date(w.safeFrom + 'T12:00:00'))}.
          </p>
        ))}
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
          {impliedTradeFx && fxRaw && (
            <>
              {' '}
              <button type="button" className="link-btn" onClick={() => setFxRate(toInputValue(impliedTradeFx.toString()))}>
                Usar el cambio que cuadra ({toInputValue(impliedTradeFx.toString())})
              </button>
            </>
          )}
        </p>
      )}
      {income && netRaw && !split && withholding.trim() === '' && !income.unclassifiedEur.isZero() && (
        <p className="small muted">Con el neto que has puesto, la retención total sale {formatMoney(income.unclassifiedEur, 'EUR')}.</p>
      )}
      {income?.mismatchEur && (
        <p className="small muted">
          El neto no cuadra con bruto − retenciones − comisiones por {formatMoney(income.mismatchEur.abs(), 'EUR')}. Se guardará el neto que has puesto, que es el importe real.
          {impliedFx && fxRaw !== undefined && (
            <>
              {' '}
              <button type="button" className="link-btn" onClick={() => setFxRate(toInputValue(impliedFx.toString()))}>
                Usar el cambio que cuadra ({toInputValue(impliedFx.toString())})
              </button>
            </>
          )}
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
      {(type === 'venta' || transfer) && available && q && d(q).gt(available) && (
        <p className="error-text">{transfer ? 'Traspasas' : 'Vendes'} más {transfer ? 'participaciones' : 'títulos'} de los que tenías en esa fecha. Revisa la cantidad o añade antes la compra.</p>
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
