import { useMemo } from 'react'
import { ASSET_TYPES, type Asset, type Movement } from '../../domain/types'
import { TYPE_COLORS } from './Cartera'

interface Props {
  assets: Asset[]
  movements: Movement[]
  onOpen: (a: Asset) => void
  onAdd: () => void
}

export function Activos({ assets, movements, onOpen, onAdd }: Props) {
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const m of movements) c.set(m.assetId, (c.get(m.assetId) ?? 0) + 1)
    return c
  }, [movements])

  return (
    <>
      <div className="screen-head">
        <h1>Activos</h1>
        <button className="btn small" onClick={onAdd}>
          Añadir activo
        </button>
      </div>
      {assets.length === 0 ? (
        <div className="empty">
          <p>Un activo es cualquier cosa en la que inviertes: una acción, un ETF, un fondo, un bono, oro…</p>
          <p>Dalo de alta una vez y luego regístrale los movimientos.</p>
          <button className="btn primary" onClick={onAdd}>
            Añadir activo
          </button>
        </div>
      ) : (
        <ul className="rows">
          {assets.map((a) => {
            const n = counts.get(a.id) ?? 0
            return (
              <li key={a.id}>
                <button className="row" onClick={() => onOpen(a)}>
                  <span className="row-title">
                    <i
                      aria-hidden
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        marginRight: 8,
                        background: TYPE_COLORS[a.type],
                      }}
                    />
                    {a.name}
                  </span>
                  <span className="row-end small muted">{n === 1 ? '1 movimiento' : `${n} movimientos`}</span>
                  <span className="row-sub">
                    {[ASSET_TYPES[a.type], a.ticker, a.isin, a.currency].filter(Boolean).join(', ')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
