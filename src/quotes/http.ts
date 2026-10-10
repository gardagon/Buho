import type { Fetcher } from './types'

/** Segundos que se espera a cada petición antes de darla por perdida. */
export const REQUEST_TIMEOUT_MS = 25_000

/**
 * `fetch` con límite de espera: una petición colgada (red lenta, proxy sin
 * responder) no deja la actualización esperando para siempre. Al agotarse se
 * comporta como una caída de red, que es lo que ya tratan los proveedores.
 */
export const timedFetch: Fetcher = async (input, init) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: init?.signal ?? ctl.signal })
  } catch (e) {
    if (ctl.signal.aborted) throw new TypeError('Failed to fetch')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
