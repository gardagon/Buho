import { formatMoney, formatPercent } from '../../domain/numbers'
import { ASSET_TYPES, type Asset } from '../../domain/types'
import { dayChange, pickPrice } from '../../domain/valuation'
import { useQuotes } from '../../quotes/QuotesContext'
import { priceNote, RefreshLine } from '../prices'

interface Props {
  assets: Asset[]
  onOpen: (asset: Asset) => void
  onAdd: () => void
}

export function Seguimiento({ assets, onOpen, onAdd }: Props) {
  const { quotes, hasKey } = useQuotes()
  const watched = assets.filter((a) => a.watched)

  return (
    <>
      <div className="screen-head">
        <h1>Seguimiento</h1>
        {watched.length > 0 && (
          <button className="btn small" onClick={onAdd}>
            Seguir un valor
          </button>
        )}
      </div>

      {watched.length === 0 ? (
        <div className="empty">
          <p>No sigues ningún valor todavía.</p>
          <p>
            Elige los valores que quieres vigilar y aquí verás su precio y cómo se mueven, los tengas en cartera o no. Para
            seguir uno que ya has dado de alta, ábrelo en Activos y marca «Seguir».
          </p>
          <button className="btn primary" onClick={onAdd}>
            Seguir un valor
          </button>
        </div>
      ) : (
        <>
          <RefreshLine />
          <ul className="rows">
            {watched.map((a) => {
              const price = pickPrice(a, quotes.get(a.id))
              const change = price && dayChange(price)
              return (
                <li key={a.id}>
                  <button className="row" onClick={() => onOpen(a)}>
                    <span className="row-title">{a.name}</span>
                    <span className="row-end num">
                      <strong>{price ? formatMoney(price.price, price.currency) : '—'}</strong>
                    </span>
                    <span className="row-sub">
                      {a.ticker ?? ASSET_TYPES[a.type]}
                      {price && ` · ${priceNote(price)}`}
                    </span>
                    {change ? (
                      <span className={`row-sub row-end num ${change.abs.isNeg() ? 'loss' : 'gain'}`}>
                        {formatPercent(change.pct)}
                      </span>
                    ) : (
                      <span className="row-sub row-end">{price ? '' : 'Sin precio'}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {!hasKey && (
            <p className="small muted" style={{ marginTop: 8 }}>
              Para ver cotizaciones automáticas añade tu clave de Finnhub en Ajustes. Si no, usa un precio manual en cada activo.
            </p>
          )}
        </>
      )}
    </>
  )
}
