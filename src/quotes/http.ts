import type { Fetcher } from './types'

/** Segundos que se espera a cada petición antes de darla por perdida. */
export const REQUEST_TIMEOUT_MS = 25_000

/** Una petición de red de las cotizaciones, para el diagnóstico de Ajustes. Nunca lleva claves. */
export interface NetEntry {
  at: string
  /** Destino sin parámetros secretos: `finnhub.io/api/v1/quote ?symbol=AAPL`. */
  target: string
  ms: number
  /** Código HTTP, o `timeout` / `error` si no hubo respuesta. */
  status: number | 'timeout' | 'error'
}

const MAX_ENTRIES = 80
let entries: NetEntry[] = []
const listeners = new Set<() => void>()

export const netLog = () => entries
export function clearNetLog() {
  entries = []
  listeners.forEach((l) => l())
}
export function subscribeNetLog(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Host, ruta y los parámetros que no son secretos. */
function describe(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    const u = new URL(raw)
    const keep = ['symbol', 'symbols', 'range', 'q', 'base', 'from', 'to']
    const params = [...u.searchParams].filter(([k]) => keep.includes(k)).map(([k, v]) => `${k}=${v}`)
    return u.host + u.pathname + (params.length ? ' ?' + params.join('&') : '')
  } catch {
    return 'petición'
  }
}

function record(entry: NetEntry) {
  entries = [entry, ...entries].slice(0, MAX_ENTRIES)
  listeners.forEach((l) => l())
}

/**
 * `fetch` con límite de espera: una petición colgada (red lenta, proxy sin
 * responder) no deja la actualización esperando para siempre. Al agotarse se
 * comporta como una caída de red, que es lo que ya tratan los proveedores.
 * Anota cada petición (destino, estado y duración) para el diagnóstico.
 */
export const timedFetch: Fetcher = async (input, init) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS)
  const t0 = performance.now()
  const target = describe(input)
  const done = (status: NetEntry['status']) => record({ at: new Date().toISOString(), target, ms: Math.round(performance.now() - t0), status })
  try {
    const res = await fetch(input, { ...init, signal: init?.signal ?? ctl.signal })
    done(res.status)
    return res
  } catch (e) {
    done(ctl.signal.aborted ? 'timeout' : 'error')
    if (ctl.signal.aborted) throw new TypeError('Failed to fetch')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
