import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { Asset, Movement } from './domain/types'
import { useSync } from './sync/SyncContext'
import { AssetForm } from './ui/AssetForm'
import { usePortfolio } from './ui/hooks'
import { IconActivos, IconAjustes, IconCartera, IconMovimientos } from './ui/icons'
import { MovementForm } from './ui/MovementForm'
import { Activos } from './ui/screens/Activos'
import { Ajustes } from './ui/screens/Ajustes'
import { Cartera } from './ui/screens/Cartera'
import { Movimientos } from './ui/screens/Movimientos'

const ROUTES = [
  { id: 'cartera', label: 'Cartera', Icon: IconCartera },
  { id: 'movimientos', label: 'Movimientos', Icon: IconMovimientos },
  { id: 'activos', label: 'Activos', Icon: IconActivos },
  { id: 'ajustes', label: 'Ajustes', Icon: IconAjustes },
] as const
type Route = (typeof ROUTES)[number]['id']

function readRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  return (ROUTES.find((r) => r.id === h)?.id ?? 'cartera') as Route
}

type Editing =
  | { kind: 'movement'; movement?: Movement; assetId?: string }
  | { kind: 'asset'; asset?: Asset }
  | null

export function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [editing, setEditing] = useState<Editing>(null)
  const [assetFilter, setAssetFilter] = useState('')
  const { assets, movements, portfolio } = usePortfolio()

  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const go = (r: Route) => {
    location.hash = `/${r}`
  }

  const addMovement = () =>
    assets.length === 0 ? setEditing({ kind: 'asset' }) : setEditing({ kind: 'movement', assetId: assetFilter || undefined })

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./favicon.svg" alt="" />
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

      <main>
        {route === 'cartera' && (
          <Cartera
            portfolio={portfolio}
            hasAssets={assets.length > 0}
            onAdd={addMovement}
            onOpenAsset={(id) => {
              setAssetFilter(id)
              go('movimientos')
            }}
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

      {route !== 'ajustes' && (
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
      {editing?.kind === 'asset' && (
        <AssetForm
          asset={editing.asset}
          movementCount={editing.asset ? movements.filter((m) => m.assetId === editing.asset!.id).length : 0}
          onClose={(savedId) => {
            // Si era el primer activo, enlazamos directamente con su primera compra.
            if (!editing.asset && savedId && movements.length === 0) setEditing({ kind: 'movement', assetId: savedId })
            else setEditing(null)
          }}
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
