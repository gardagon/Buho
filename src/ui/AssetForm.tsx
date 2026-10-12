import { useState } from 'react'
import { addPricePoint, deleteAsset, saveAsset } from '../data/repo'
import { formatMoney, parseUserNumber } from '../domain/numbers'
import { rateForPoint } from '../quotes/fx'
import { useQuotes } from '../quotes/QuotesContext'
import { searchSecurities, type SearchResult } from '../quotes/service'
import { ASSET_TYPES, type Asset, type AssetType } from '../domain/types'
import { Field, Sheet } from './Sheet'
import { Spinner } from './Spinner'
import { useToast } from './Toast'

export const CURRENCIES: Record<string, string> = {
  EUR: 'Euro',
  USD: 'Dólar estadounidense',
  GBP: 'Libra esterlina',
  CHF: 'Franco suizo',
  JPY: 'Yen japonés',
  CAD: 'Dólar canadiense',
  AUD: 'Dólar australiano',
  HKD: 'Dólar de Hong Kong',
  SEK: 'Corona sueca',
  NOK: 'Corona noruega',
  DKK: 'Corona danesa',
}
const OTHER = '__otra'

/** Nombre sin mayúsculas ni signos, para reconocer el mismo fondo cotizando en otra bolsa. */
const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

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
  // Si la divisa del activo no está en la lista, se enseña el campo para escribirla.
  const [otherCurrency, setOtherCurrency] = useState(!!asset && !(asset.currency in CURRENCIES))
  const [saving, setSaving] = useState(false)
  // Buscar el ticker de Yahoo a partir del ISIN: cada bolsa donde cotiza el valor tiene el suyo.
  const { hasKey, hasYahoo } = useQuotes()
  const [finding, setFinding] = useState(false)
  const [found, setFound] = useState<SearchResult[] | null>(null)
  const [findError, setFindError] = useState('')

  const isinOk = isin.trim() === '' || /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin.trim().toUpperCase())
  const priceParsed = manualPrice.trim() === '' ? undefined : parseUserNumber(manualPrice)
  const priceOk = manualPrice.trim() === '' || (priceParsed !== null && Number(priceParsed) > 0)
  const valid = priceOk && name.trim() !== '' && /^[A-Z]{3}$/.test(currency.trim().toUpperCase()) && isinOk

  async function findByIsin() {
    setFinding(true)
    setFindError('')
    try {
      // Yahoo devuelve una sola cotización por ISIN (la principal). Las demás bolsas del mismo valor salen buscando su nombre.
      const byIsin = await searchSecurities(isin.trim().toUpperCase())
      let results = byIsin
      if (byIsin.length > 0) {
        try {
          const key = nameKey(byIsin[0].hit.name)
          const byName = await searchSecurities(byIsin[0].hit.name)
          const seen = new Set(byIsin.map((r) => r.hit.symbol))
          results = [...byIsin, ...byName.filter((r) => !seen.has(r.hit.symbol) && nameKey(r.hit.name) === key)]
        } catch {
          /* con una sola bolsa basta para seguir */
        }
      }
      setFound(results)
      if (results.length === 0) setFindError('No se ha encontrado ese ISIN. Prueba con el nombre del valor o escribe el ticker a mano.')
    } catch (e) {
      setFound(null)
      setFindError(e instanceof Error ? e.message : 'No se pudo buscar. Comprueba la conexión.')
    } finally {
      setFinding(false)
    }
  }

  function pick(r: SearchResult) {
    setTicker(r.hit.symbol)
    const c = (r.quote?.currency ?? r.hit.currency).toUpperCase()
    setCurrency(c)
    setOtherCurrency(!(c in CURRENCIES))
    setType(r.hit.type)
    if (!name.trim()) setName(found?.[0]?.hit.name ?? r.hit.name)
    if (!market.trim() && r.hit.exchange) setMarket(r.hit.exchange)
    setFound(null)
  }

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
        <Field label="Mercado">
          <input value={market} onChange={(e) => setMarket(e.target.value)} placeholder="BME, Xetra, NASDAQ…" />
        </Field>
      </div>
      <Field label="Divisa de cotización" hint="La moneda en la que cotiza en su mercado">
        <select
          value={otherCurrency ? OTHER : currency}
          onChange={(e) => {
            if (e.target.value === OTHER) {
              setOtherCurrency(true)
              setCurrency('')
            } else {
              setOtherCurrency(false)
              setCurrency(e.target.value)
            }
          }}
        >
          {Object.entries(CURRENCIES).map(([code, name]) => (
            <option key={code} value={code}>
              {code} · {name}
            </option>
          ))}
          <option value={OTHER}>Otra…</option>
        </select>
      </Field>
      {otherCurrency && (
        <Field label="Código de la divisa" hint="Tres letras, p. ej. PLN o MXN">
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            autoCapitalize="characters"
            placeholder="PLN"
            aria-invalid={tried && !/^[A-Z]{3}$/.test(currency)}
          />
        </Field>
      )}
      <div className="grid-2">
        <Field label="Ticker" hint="El de Yahoo, con la bolsa: SXR8.DE, IBE.MC. No sirve la etiqueta del bróker.">
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
      {isin.trim().length === 12 && isinOk && (hasYahoo || hasKey) && (
        <div className="stack">
          <button type="button" className="btn small" onClick={() => void findByIsin()} disabled={finding}>
            {finding ? 'Buscando…' : 'Buscar el ticker con el ISIN'}
          </button>
          {findError && <p className="error-text">{findError}</p>}
          {found && found.length > 0 && (
            <>
              <p className="small muted" style={{ margin: 0 }}>
                Cada bolsa tiene su símbolo. Elige la que uses (la de euros suele coincidir con el precio de tu bróker).
              </p>
              <ul className="rows">
                {found.map((r) => (
                  <li key={r.hit.symbol}>
                    <button type="button" className="row" onClick={() => pick(r)}>
                      <span className="row-title">{r.hit.name}</span>
                      <span className="row-end num">{r.quote ? formatMoney(r.quote.price, r.quote.currency) : ''}</span>
                      <span className="row-sub">
                        {r.hit.symbol} · {r.hit.exchange ?? 'sin bolsa'}
                      </span>
                      <span className="row-sub row-end">Elegir</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
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
