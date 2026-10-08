import { useState } from 'react'
import { deleteAsset, saveAsset } from '../data/repo'
import { ASSET_TYPES, type Asset, type AssetType } from '../domain/types'
import { Field, Sheet } from './Sheet'
import { useToast } from './Toast'

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'SEK', 'NOK', 'DKK', 'AUD', 'HKD']

interface Props {
  asset?: Asset
  movementCount?: number
  onClose: (savedId?: string) => void
}

export function AssetForm({ asset, movementCount = 0, onClose }: Props) {
  const toast = useToast()
  const [name, setName] = useState(asset?.name ?? '')
  const [type, setType] = useState<AssetType>(asset?.type ?? 'accion')
  const [currency, setCurrency] = useState(asset?.currency ?? 'EUR')
  const [ticker, setTicker] = useState(asset?.ticker ?? '')
  const [isin, setIsin] = useState(asset?.isin ?? '')
  const [market, setMarket] = useState(asset?.market ?? '')
  const [note, setNote] = useState(asset?.note ?? '')
  const [tried, setTried] = useState(false)

  const isinOk = isin.trim() === '' || /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin.trim().toUpperCase())
  const valid = name.trim() !== '' && /^[A-Z]{3}$/.test(currency.trim().toUpperCase()) && isinOk

  async function submit() {
    setTried(true)
    if (!valid) return
    const id = await saveAsset(
      {
        name: name.trim(),
        type,
        currency: currency.trim().toUpperCase(),
        ticker: ticker.trim().toUpperCase() || undefined,
        isin: isin.trim().toUpperCase() || undefined,
        market: market.trim() || undefined,
        note: note.trim() || undefined,
      },
      asset?.id,
    )
    toast(asset ? 'Activo guardado' : 'Activo añadido')
    onClose(id)
  }

  async function remove() {
    if (!asset) return
    const extra = movementCount > 0 ? ` y sus ${movementCount} movimientos` : ''
    if (!confirm(`¿Eliminar ${asset.name}${extra}?`)) return
    await deleteAsset(asset.id)
    toast('Activo eliminado')
    onClose()
  }

  return (
    <Sheet
      title={asset ? 'Editar activo' : 'Nuevo activo'}
      onClose={() => onClose()}
      onSubmit={submit}
      footer={
        <>
          {asset && (
            <button type="button" className="btn danger" onClick={remove}>
              Eliminar
            </button>
          )}
          <span className="spacer" />
          <button type="submit" className="btn primary">
            {asset ? 'Guardar activo' : 'Añadir activo'}
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
      <Field label="Notas">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  )
}
