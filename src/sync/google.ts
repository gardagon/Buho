/**
 * Acceso a Google Drive desde el navegador, sin servidor propio.
 *
 * - Inicio de sesión con Google Identity Services (modelo de token).
 * - Permiso `drive.file`: la app solo ve los archivos que ella misma crea.
 *   No puede leer el resto del Drive del usuario.
 * - El token vive solo en memoria y caduca en ~1 hora; no se guarda en disco.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const DRIVE_FILE_NAME = 'buho-cartera.json'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}
interface TokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void
  callback: (r: TokenResponse) => void
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (c: {
            client_id: string
            scope: string
            callback: (r: TokenResponse) => void
            error_callback?: (e: { type: string; message?: string }) => void
          }) => TokenClient
          revoke: (token: string, done?: () => void) => void
        }
      }
    }
  }
}

let gisPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisPromise = null
      reject(new Error('No se pudo cargar el inicio de sesión de Google. Comprueba la conexión.'))
    }
    document.head.appendChild(s)
  })
  return gisPromise
}

let token: { value: string; expiresAt: number } | null = null
let client: TokenClient | null = null
let clientId: string | null = null
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

export const hasValidToken = () => !!token && token.expiresAt > Date.now() + 60_000

function settle(r: TokenResponse) {
  const p = pending
  pending = null
  if (!p) return
  if (r.error || !r.access_token) {
    p.reject(new Error(r.error === 'access_denied' ? 'Has cancelado el acceso a Google Drive.' : r.error_description || r.error || 'Google no ha devuelto acceso.'))
    return
  }
  token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
  p.resolve(r.access_token)
}

/**
 * Pide un token a Google. La primera vez muestra la pantalla de permisos;
 * después la ventana solo parpadea. Tiene que llamarse desde un toque o clic
 * del usuario, o el navegador bloqueará la ventana emergente.
 */
export async function requestToken(id: string): Promise<string> {
  if (hasValidToken()) return token!.value
  await loadGis()
  if (!client || clientId !== id) {
    client = window.google!.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: DRIVE_SCOPE,
      callback: settle,
      error_callback: (e) =>
        settle({ error: e.type === 'popup_closed' ? 'access_denied' : e.type, error_description: e.message }),
    })
    clientId = id
  }
  pending?.reject(new Error('Se ha iniciado otra conexión con Google.'))
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    client!.requestAccessToken({ prompt: '' })
  })
}

export function signOut() {
  if (token && window.google) window.google.accounts.oauth2.revoke(token.value)
  token = null
}

class DriveError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!hasValidToken()) throw new DriveError('La sesión de Google ha caducado. Vuelve a conectar.', 401)
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token!.value}` },
  })
  if (res.status === 401) {
    token = null
    throw new DriveError('La sesión de Google ha caducado. Vuelve a conectar.', 401)
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.error?.message ?? ''
    } catch {
      /* sin detalle */
    }
    throw new DriveError(`Google Drive ha respondido ${res.status}${detail ? `: ${detail}` : ''}`, res.status)
  }
  return res
}

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export async function getAccountEmail(): Promise<string | undefined> {
  const res = await driveFetch(`${API}/about?fields=user(emailAddress)`)
  return (await res.json())?.user?.emailAddress
}

/** Busca el archivo de la cartera entre los que ha creado la app. */
export async function findFile(): Promise<{ id: string; modifiedTime: string } | null> {
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`)
  const res = await driveFetch(`${API}/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,modifiedTime)`)
  const files: { id: string; modifiedTime: string }[] = (await res.json()).files ?? []
  return files[0] ?? null
}

export async function downloadFile(id: string): Promise<string> {
  const res = await driveFetch(`${API}/files/${id}?alt=media`)
  return res.text()
}

export async function createFile(content: string): Promise<string> {
  const boundary = 'buho' + Math.random().toString(36).slice(2)
  const metadata = { name: DRIVE_FILE_NAME, mimeType: 'application/json', description: 'Datos de la app Buho. No lo edites a mano.' }
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
  const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return (await res.json()).id
}

export async function updateFile(id: string, content: string): Promise<void> {
  await driveFetch(`${UPLOAD}/files/${id}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: content,
  })
}

export const isNotFound = (e: unknown) => e instanceof DriveError && e.status === 404
