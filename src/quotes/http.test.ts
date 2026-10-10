import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearNetLog, netLog, REQUEST_TIMEOUT_MS, timedFetch } from './http'

describe('timedFetch', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('da por perdida una petición que no responde y falla como una caída de red', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', (_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('abort', 'AbortError')))))
    const p = expect(timedFetch('https://x.test')).rejects.toThrow('Failed to fetch')
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
    await p
  })

  it('devuelve la respuesta si llega a tiempo', async () => {
    vi.stubGlobal('fetch', async () => new Response('ok'))
    expect(await (await timedFetch('https://x.test')).text()).toBe('ok')
  })

  it('anota cada petición con su estado y duración, sin claves', async () => {
    clearNetLog()
    vi.stubGlobal('fetch', async () => new Response('x', { status: 403 }))
    await timedFetch('https://finnhub.io/api/v1/quote?symbol=SAN.MC&token=SECRETO')
    const [e] = netLog()
    expect(e.status).toBe(403)
    expect(e.target).toBe('finnhub.io/api/v1/quote ?symbol=SAN.MC')
    expect(JSON.stringify(netLog())).not.toContain('SECRETO')
  })
})
