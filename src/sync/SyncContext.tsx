import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { getMeta } from '../data/db'
import { onLocalChange } from '../data/repo'
import * as sync from './sync'

type Status = 'off' | 'needs-login' | 'syncing' | 'ok' | 'error'

interface SyncState {
  status: Status
  email?: string
  lastSyncAt?: string
  error?: string
  hasClientId: boolean
  connect: () => Promise<void>
  syncNow: () => Promise<void>
  disconnect: () => Promise<void>
  refreshConfig: () => Promise<void>
}

const Ctx = createContext<SyncState | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('off')
  const [email, setEmail] = useState<string>()
  const [lastSyncAt, setLastSyncAt] = useState<string>()
  const [error, setError] = useState<string>()
  const [hasClientId, setHasClientId] = useState(false)
  const running = useRef<Promise<void> | null>(null)
  const again = useRef(false)

  const refreshConfig = useCallback(async () => {
    const [connected, mail, last, clientId] = await Promise.all([
      getMeta<boolean>(sync.META.connected),
      getMeta<string>(sync.META.email),
      getMeta<string>(sync.META.lastSync),
      sync.getClientId(),
    ])
    setHasClientId(!!clientId)
    setEmail(mail)
    setLastSyncAt(last)
    // El token no se guarda: al abrir la app hay que tocar para reconectar.
    setStatus(connected ? (sync.hasValidToken() ? 'ok' : 'needs-login') : 'off')
  }, [])

  useEffect(() => {
    void refreshConfig()
  }, [refreshConfig])

  const run = useCallback(async () => {
    if (running.current) {
      again.current = true
      return running.current
    }
    const p = (async () => {
      setStatus('syncing')
      setError(undefined)
      try {
        do {
          again.current = false
          const r = await sync.syncNow()
          setLastSyncAt(r.at)
        } while (again.current)
        setEmail(await getMeta<string>(sync.META.email))
        setStatus('ok')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStatus(sync.hasValidToken() ? 'error' : 'needs-login')
      } finally {
        running.current = null
      }
    })()
    running.current = p
    return p
  }, [])

  const connect = useCallback(async () => {
    setError(undefined)
    try {
      setStatus('syncing')
      setEmail(await sync.connect())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('needs-login')
      return
    }
    await run()
  }, [run])

  const disconnect = useCallback(async () => {
    await sync.disconnect()
    setEmail(undefined)
    setStatus('off')
  }, [])

  // Tras cada cambio local, sincroniza a los pocos segundos si hay sesión.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onLocalChange(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (sync.hasValidToken()) void run()
      }, 3000)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [run])

  return (
    <Ctx.Provider value={{ status, email, lastSyncAt, error, hasClientId, connect, syncNow: run, disconnect, refreshConfig }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSync() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSync fuera de SyncProvider')
  return v
}
