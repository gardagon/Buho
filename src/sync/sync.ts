import { getMeta, setMeta } from '../data/db'
import { parseSnapshot } from '../data/merge'
import { exportSnapshot, mergeIntoLocal } from '../data/repo'
import * as g from './google'

/**
 * Sincronización con un único archivo `buho-cartera.json` en el Drive del
 * usuario:
 *   1. descarga la copia de Drive (si existe),
 *   2. la fusiona con la local registro a registro,
 *   3. sube el resultado.
 * Si dos dispositivos editan a la vez, gana el cambio más reciente de cada
 * registro; no se pierde ningún movimiento nuevo.
 */

export const META = {
  clientId: 'googleClientId',
  fileId: 'driveFileId',
  lastSync: 'lastSyncAt',
  connected: 'driveConnected',
  email: 'driveEmail',
} as const

export async function getClientId(): Promise<string | undefined> {
  const fromSettings = await getMeta<string>(META.clientId)
  return fromSettings?.trim() || import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || undefined
}

export async function connect(): Promise<string | undefined> {
  const id = await getClientId()
  if (!id) throw new Error('Falta el ID de cliente de Google. Añádelo en Ajustes.')
  await g.requestToken(id)
  const email = await g.getAccountEmail()
  await setMeta(META.connected, true)
  await setMeta(META.email, email)
  return email
}

export async function disconnect() {
  g.signOut()
  await setMeta(META.connected, false)
  await setMeta(META.email, undefined)
  await setMeta(META.fileId, undefined)
}

export async function syncNow(): Promise<{ at: string; created: boolean }> {
  if (!g.hasValidToken()) await connect()

  let fileId = await getMeta<string>(META.fileId)
  let remoteText: string | null = null

  if (fileId) {
    try {
      remoteText = await g.downloadFile(fileId)
    } catch (e) {
      if (!g.isNotFound(e)) throw e
      fileId = undefined // lo borraron desde Drive: buscamos o creamos otro
    }
  }
  if (!fileId) {
    const found = await g.findFile()
    if (found) {
      fileId = found.id
      remoteText = await g.downloadFile(found.id)
    }
  }

  const merged = remoteText ? await mergeIntoLocal(parseSnapshot(remoteText)) : await exportSnapshot()
  const content = JSON.stringify(merged)

  let created = false
  if (fileId) {
    await g.updateFile(fileId, content)
  } else {
    fileId = await g.createFile(content)
    created = true
  }

  const at = new Date().toISOString()
  await setMeta(META.fileId, fileId)
  await setMeta(META.lastSync, at)
  return { at, created }
}

export { hasValidToken } from './google'
