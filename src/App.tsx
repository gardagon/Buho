import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { Asset, Movement } from './domain/types'
import { useSync } from './sync/SyncContext'
import { AssetForm } from './ui/AssetForm'
import { FollowSheet } from './ui/FollowSheet'
import { PositionDetail } from './ui/PositionDetail'
import { PriceDetail } from './ui/PriceDetail'
import { usePortfolio } from './ui/hooks'
import { useSwipeNav } from './ui/useSwipeNav'
import { IconActivos, IconAjustes, IconCartera, IconMovimientos, IconSeguimiento } from './ui/icons'
import { MovementForm } from './ui/MovementForm'
import { Activos } from './ui/screens/Activos'
import { Ajustes } from './ui/screens/Ajustes'
import { Cartera } from './ui/screens/Cartera'
import { Movimientos } from './ui/screens/Movimientos'
import { Seguimiento } from './ui/screens/Seguimiento'

const ROUTES = [
  { id: 'seguimiento', label: 'Seguimiento', Icon: IconSeguimiento },
  { id: 'cartera', label: 'Cartera', Icon: IconCartera },
  { id: 'movimientos', label: 'Movimientos', Icon: IconMovimientos },
  { id: 'activos', label: 'Activos', Icon: IconActivos },
  { id: 'ajustes', label: 'Ajustes', Icon: IconAjustes },
] as const
type Route = (typeof ROUTES)[number]['id']
const ROUTE_IDS: readonly string[] = ROUTES.map((r) => r.id)

function readRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  return (ROUTES.find((r) => r.id === h)?.id ?? 'seguimiento') as Route
}

type Editing =
  | { kind: 'movement'; movement?: Movement; assetId?: string }
  | { kind: 'asset'; asset?: Asset; watched?: boolean }
  | { kind: 'follow' }
  | { kind: 'prices'; asset: Asset }
  | { kind: 'position'; assetId: string }
  | null

export function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [editing, setEditing] = useState<Editing>(null)
  const [assetFilter, setAssetFilter] = useState('')
  const { assets, movements, portfolio } = usePortfolio()

  // Dirección del último cambio de pestaña, para animar la entrada de la pantalla nueva.
  const [slide, setSlide] = useState<'left' | 'right' | null>(null)
  const current = useRef(route)

  useEffect(() => {
    const on = () => {
      const next = readRoute()
      const order = ROUTES.map((r) => r.id as string)
      setSlide(order.indexOf(next) > order.indexOf(current.current) ? 'left' : 'right')
      current.current = next
      setRoute(next)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const go = useCallback((r: Route) => {
    location.hash = `/${r}`
  }, [])

  // Deslizar a los lados cambia de pestaña, en el orden de la barra de navegación.
  useSwipeNav(ROUTE_IDS, route, go as (id: string) => void)

  const addMovement = () =>
    assets.length === 0 ? setEditing({ kind: 'asset' }) : setEditing({ kind: 'movement', assetId: assetFilter || undefined })

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./pwa-64x64.png" alt="" />
          Buho
        </div>
        <SyncPill onOpenSettings={() => go('ajustes')} />
      </header>

      <nav className="nav" aria-label="Secciones">
        {ROUTES.map(({ id, label, Icon }) => (
          <a key={id} href={`#/${id}`} aria-current={route === id ? 'page' : undefined}>
            <Icon />
            {label}
          </a>
        ))}
      </nav>

      <main key={route} className={slide ? `slide-${slide}` : undefined}>
        {route === 'cartera' && (
          <Cartera
            portfolio={portfolio}
            onAdd={() => go('movimientos')}
            onOpenAsset={(id) => setEditing({ kind: 'position', assetId: id })}
          />
        )}
        {route === 'movimientos' && (
          <Movimientos
            movements={movements}
            assets={assets}
            filter={assetFilter}
            onFilter={setAssetFilter}
            onOpen={(m) => setEditing({ kind: 'movement', movement: m })}
            onAdd={addMovement}
          />
        )}
        {route === 'seguimiento' && (
          <Seguimiento
            assets={assets}
            onOpen={(a) => setEditing({ kind: 'prices', asset: a })}
            onAdd={() => setEditing({ kind: 'follow' })}
          />
        )}
        {route === 'activos' && (
          <Activos
            assets={assets}
            movements={movements}
            onOpen={(a) => setEditing({ kind: 'asset', asset: a })}
            onAdd={() => setEditing({ kind: 'asset' })}
          />
        )}
        {route === 'ajustes' && <Ajustes />}
      </main>

      {route === 'movimientos' && (
        <button className="btn primary fab" onClick={addMovement}>
          Añadir movimiento
        </button>
      )}

      {editing?.kind === 'movement' && (
        <MovementForm
          movement={editing.movement}
          defaultAssetId={editing.assetId}
          assets={assets}
          movements={movements}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === 'position' &&
        (() => {
          const position = portfolio.positions.find((p) => p.asset.id === editing.assetId)
          if (!position) return null
          return (
            <PositionDetail
              position={position}
              portfolio={portfolio}
              movements={movements}
              onClose={() => setEditing(null)}
              onOpenMovements={() => {
                setAssetFilter(editing.assetId)
                setEditing(null)
                go('movimientos')
              }}
              onOpenPrices={() => setEditing({ kind: 'prices', asset: position.asset })}
            />
          )
        })()}
      {editing?.kind === 'prices' && (
        <PriceDetail
          asset={assets.find((a) => a.id === editing.asset.id) ?? editing.asset}
          onClose={() => setEditing(null)}
          onEdit={() => setEditing({ kind: 'asset', asset: editing.asset })}
        />
      )}
      {editing?.kind === 'follow' && (
        <FollowSheet
          assets={assets}
          onClose={() => setEditing(null)}
          onManual={() => setEditing({ kind: 'asset', watched: true })}
        />
      )}
      {editing?.kind === 'asset' && (
        <AssetForm
          asset={editing.asset}
          defaultWatched={editing.watched}
          onOpenPrices={editing.asset ? () => setEditing({ kind: 'prices', asset: editing.asset! }) : undefined}
          movementCount={editing.asset ? movements.filter((m) => m.assetId === editing.asset!.id).length : 0}
          onClose={() => setEditing(null)}
        />
      )}

      <UpdateBanner />
    </div>
  )
}

function SyncPill({ onOpenSettings }: { onOpenSettings: () => void }) {
  const s = useSync()
  const map = {
    off: { state: 'off', text: 'Solo en este dispositivo', act: onOpenSettings },
    'needs-login': { state: 'off', text: 'Sincronizar', act: s.connect },
    syncing: { state: 'syncing', text: 'Sincronizando', act: () => {} },
    ok: { state: 'ok', text: 'En Drive', act: s.syncNow },
    error: { state: 'error', text: 'Error al sincronizar', act: onOpenSettings },
  } as const
  const v = map[s.status]
  return (
    <button className="sync-pill" data-state={v.state} onClick={v.act} title={s.error}>
      <span className="dot" aria-hidden />
      {v.text}
    </button>
  )
}

function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="toast" role="status">
      Hay una versión nueva de Buho.
      <button className="btn small" onClick={() => updateServiceWorker(true)}>
        Actualizar
      </button>
    </div>
  )
}
