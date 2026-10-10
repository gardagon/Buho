import { useEffect, useMemo, useRef, useState } from 'react'
import { saveAsset } from '../data/repo'
import { formatMoney } from '../domain/numbers'
import { ASSET_TYPES, type Asset } from '../domain/types'
import { pickPrice } from '../domain/valuation'
import { useQuotes } from '../quotes/QuotesContext'
import { followSecurity, searchSecurities, type SearchResult } from '../quotes/service'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

interface Props {
  assets: Asset[]
  onClose: () => void
  /** Abre el formulario completo para dar de alta un valor a mano. */
  onManual: () => void
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: SearchResult[] }
  | { status: 'error'; message: string }

export function FollowSheet({ assets, onClose, onManual }: Props) {
  const toast = useToast()
  const { hasKey, hasYahoo, quotes, loadHistory } = useQuotes()
  const canSearch = hasKey || hasYahoo
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })
  const lastRequest = useRef(0)

  const q = query.trim()
  // Activos ya dados de alta que todavía no se siguen: un toque y listo.
  const unfollowed = useMemo(() => {
    const needle = q.toLowerCase()
    return assets.filter(
      (a) => !a.watched && (!needle || a.name.toLowerCase().includes(needle) || a.ticker?.toLowerCase().includes(needle)),
    )
  }, [assets, q])

  async function search(text: string) {
    const id = ++lastRequest.current
    setState({ status: 'loading' })
    try {
      const results = await searchSecurities(text)
      if (id === lastRequest.current) setState({ status: 'done', results })
    } catch (e) {
      if (id !== lastRequest.current) return
      const offline = e instanceof TypeError || (e instanceof Error && e.message === 'Failed to fetch')
      setState({ status: 'error', message: offline ? 'No hay conexión con Finnhub. Revisa tu conexión e inténtalo de nuevo.' : (e as Error).message })
    }
  }

  // Busca sola cuando se deja de escribir.
  useEffect(() => {
    if (!canSearch || q.length < 2) {
      lastRequest.current++
      setState({ status: 'idle' })
      return
    }
    const t = setTimeout(() => void search(q), 450)
    return () => clearTimeout(t)
  }, [q, canSearch])

  async function followExisting(a: Asset) {
    const { id: _i, createdAt: _c, updatedAt: _u, deleted: _d, ...rest } = a
    await saveAsset({ ...rest, watched: true }, a.id)
    void loadHistory()
    toast(`Sigues ${a.name}`)
    onClose()
  }

  async function follow(r: SearchResult) {
    await followSecurity(r)
    void loadHistory()
    toast(`Sigues ${r.hit.name}`)
    onClose()
  }

  return (
    <Sheet
      title="Seguir un valor"
      onClose={onClose}
      onSubmit={() => q.length >= 2 && canSearch && void search(q)}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onManual}>
            Añadir a mano
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
        </>
      }
    >
      <label className="field">
        <span>Nombre o ticker</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Apple, AAPL, Microsoft…"
          autoFocus
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>

      {!canSearch && (
        <p className="small muted">
          Para buscar valores hace falta tu clave gratuita de Finnhub o el proxy de Yahoo.{' '}
          <a href="#/ajustes" onClick={onClose}>
            Añádela en Ajustes
          </a>
          . Mientras, puedes seguir uno de tus activos o añadirlo a mano.
        </p>
      )}

      {unfollowed.length > 0 && (
        <>
          <h3 className="list-title">Tus activos</h3>
          <ul className="rows">
            {unfollowed.map((a) => {
              const price = pickPrice(a, quotes.get(a.id))
              return (
                <li key={a.id}>
                  <button type="button" className="row" onClick={() => void followExisting(a)}>
                    <span className="row-title">{a.name}</span>
                    <span className="row-end num">{price ? formatMoney(price.price, price.currency) : ''}</span>
                    <span className="row-sub">{a.ticker ?? ASSET_TYPES[a.type]}</span>
                    <span className="row-sub row-end">Seguir</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {state.status === 'loading' && <p className="small muted">Buscando…</p>}
      {state.status === 'error' && <p className="error-text">{state.message}</p>}
      {state.status === 'done' && (
        <>
          <h3 className="list-title">Resultados</h3>
          {state.results.length === 0 ? (
            <p className="small muted">No hay resultados para «{q}». Prueba con el ticker o con otro nombre.</p>
          ) : (
            <ul className="rows">
              {state.results.map((r) => (
                <li key={r.hit.symbol}>
                  <button type="button" className="row" onClick={() => void follow(r)}>
                    <span className="row-title">{r.hit.name}</span>
                    <span className="row-end num">
                      <strong>{r.quote ? formatMoney(r.quote.price, r.quote.currency) : '—'}</strong>
                    </span>
                    <span className="row-sub">
                      {r.hit.symbol} · {r.hit.exchange ?? ASSET_TYPES[r.hit.type]}
                    </span>
                    <span className="row-sub row-end">{r.quote ? 'Seguir' : 'Sin cotización · Seguir'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.results.some((r) => !r.quote) && (
            <p className="small muted">
              {hasYahoo
                ? 'No se ha podido obtener la cotización de algunos. Puedes seguirlos y ponerles un precio a mano.'
                : 'El plan gratuito de Finnhub solo da cotización de valores de EE. UU. Puedes seguir los demás y ponerles un precio manual, o configurar el proxy de Yahoo en Ajustes.'}
            </p>
          )}
        </>
      )}
    </Sheet>
  )
}
