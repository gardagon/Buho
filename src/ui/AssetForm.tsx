import { useState } from 'react'
import { addPricePoint, deleteAsset, saveAsset } from '../data/repo'
import { parseUserNumber } from '../domain/numbers'
import { rateForPoint } from '../quotes/fx'
import { ASSET_TYPES, type Asset, type AssetType } from '../domain/types'
import { Field, Sheet } from './Sheet'
import { Spinner } from './Spinner'
import { useToast } from './Toast'

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'SEK', 'NOK', 'DKK', 'AUD', 'HKD']

interface Props {
  asset?: Asset
  movementCount?: number
  /** Abre la ficha con el histórico de precios (solo al editar). */
  onOpenPrices?: () => void
  /** Valor nuevo que se da de alta para seguirlo. */
  defaultWatched?: boolean
  onClose: (savedId?: string) => void
}

export function AssetForm({ asset, movementCount = 0, defaultWatched = false, onOpenPrices, onClose }: Props) {
  const toast = useToast()
  const [name, setName] = useState(asset?.name ?? '')
  const [type, setType] = useState<AssetType>(asset?.type ?? 'accion')
  const [currency, setCurrency] = useState(asset?.currency ?? 'EUR')
  const [ticker, setTicker] = useState(asset?.ticker ?? '')
  const [isin, setIsin] = useState(asset?.isin ?? '')
  const [market, setMarket] = useState(asset?.market ?? '')
  const [note, setNote] = useState(asset?.note ?? '')
  const [manualPrice, setManualPrice] = useState('')
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10))
  const [manualCurrency, setManualCurrency] = useState<string | null>(null)
  const [watched, setWatched] = useState(asset?.watched ?? defaultWatched)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)

  const isinOk = isin.trim() === '' || /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin.trim().toUpperCase())
  const priceParsed = manualPrice.trim() === '' ? undefined : parseUserNumber(manualPrice)
  const priceOk = manualPrice.trim() === '' || (priceParsed !== null && Number(priceParsed) > 0)
  const valid = priceOk && name.trim() !== '' && /^[A-Z]{3}$/.test(currency.trim().toUpperCase()) && isinOk

  async function submit() {
    setTried(true)
    if (!valid || saving) return
    setSaving(true)
    let id: string
    try {
      id = await saveAsset(
        {
          name: name.trim(),
          type,
          currency: currency.trim().toUpperCase(),
          ticker: ticker.trim().toUpperCase() || undefined,
          isin: isin.trim().toUpperCase() || undefined,
          market: market.trim() || undefined,
          note: note.trim() || undefined,
          watched: watched || undefined,
        },
        asset?.id,
      )
    } catch (e) {
      setSaving(false)
      toast(`No se pudo guardar el activo: ${e instanceof Error ? e.message : 'error desconocido'}. Inténtalo de nuevo.`)
      return
    }
    // El precio inicial entra en el histórico de precios del activo (solo al crearlo).
    if (!asset && priceParsed) {
      try {
        const priceCurrency = manualCurrency ?? currency.trim().toUpperCase()
        const fxRate = await rateForPoint(priceCurrency, manualDate)
        await addPricePoint(id, { date: manualDate, price: priceParsed, currency: priceCurrency, fxRate })
      } catch {
        toast('Activo añadido, pero no se pudo guardar el precio. Añádelo desde su ficha.')
        onClose(id)
        return
      }
    }
    toast(asset ? 'Activo guardado' : 'Activo añadido')
    onClose(id)
  }

  async function remove() {
    if (!asset || saving) return
    const extra = movementCount > 0 ? ` y sus ${movementCount} movimientos` : ''
    if (!confirm(`¿Eliminar ${asset.name}${extra}?`)) return
    setSaving(true)
    try {
      await deleteAsset(asset.id)
    } catch {
      setSaving(false)
      toast('No se pudo eliminar el activo. Inténtalo de nuevo.')
      return
    }
    toast('Activo eliminado')
    onClose()
  }

  return (
    <Sheet
      title={asset ? 'Editar activo' : 'Nuevo activo'}
      onClose={() => onClose()}
      onSubmit={submit}
      busy={saving}
      footer={
        <>
          {asset && (
            <button type="button" className="btn danger" onClick={remove} disabled={saving}>
              Eliminar
            </button>
          )}
          <span className="spacer" />
          <button type="submit" className="btn primary" disabled={saving}>
            {saving && <Spinner />}
            {saving ? 'Guardando…' : asset ? 'Guardar activo' : 'Añadir activo'}
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Iberdrola, Vanguard Global Stock…"
          aria-invalid={tried && !name.trim()}
          autoFocus={!asset}
        />
      </Field>
      <div className="grid-2">
        <Field label="Tipo">
          <select value={type} onChange={(e) => setType(e.target.value as AssetType)}>
            {Object.entries(ASSET_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Divisa de cotización">
          <input
            list="currencies"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            autoCapitalize="characters"
            aria-invalid={tried && !/^[A-Z]{3}$/.test(currency)}
          />
          <datalist id="currencies">
            {CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Ticker" hint="Para las cotizaciones">
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="IBE.MC" autoCapitalize="characters" />
        </Field>
        <Field label="ISIN" hint={tried && !isinOk ? 'El ISIN tiene 12 caracteres, p. ej. ES0144580Y14' : undefined}>
          <input
            value={isin}
            onChange={(e) => setIsin(e.target.value)}
            placeholder="ES0144580Y14"
            maxLength={12}
            autoCapitalize="characters"
            aria-invalid={tried && !isinOk}
          />
        </Field>
      </div>
      <Field label="Mercado">
        <input value={market} onChange={(e) => setMarket(e.target.value)} placeholder="BME, Xetra, NASDAQ…" />
      </Field>
      {asset ? (
        onOpenPrices && (
          <button type="button" className="btn" onClick={onOpenPrices} disabled={saving}>
            Ver y añadir precios
          </button>
        )
      ) : (
        <>
          <div className="grid-2">
            <Field
              label="Precio actual (opcional)"
              hint={
                tried && !priceOk
                  ? 'Escribe un precio mayor que cero, p. ej. 12,34'
                  : 'Para fondos, bonos o valores sin cotización. Luego podrás ir añadiendo más.'
              }
            >
              <input
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                inputMode="decimal"
                placeholder="12,34"
                aria-invalid={tried && !priceOk}
              />
            </Field>
            <Field label="Divisa del precio" hint="La que ves en tu fuente">
              <select value={manualCurrency ?? (currency || 'EUR')} onChange={(e) => setManualCurrency(e.target.value)}>
                {[...new Set([currency || 'EUR', 'EUR', 'USD'])].map((c) => (
                  <option key={c} value={c}>
                    {c === 'EUR' ? 'Euros (€)' : c === 'USD' ? 'Dólares ($)' : c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {manualPrice.trim() !== '' && (
            <Field label="Fecha del precio">
              <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
            </Field>
          )}
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={watched} onChange={(e) => setWatched(e.target.checked)} />
        Seguir en la pantalla de Seguimiento
      </label>
      <Field label="Notas">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  )
}
