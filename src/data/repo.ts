import { db } from './db'
import { mergeSnapshots } from './merge'
import type { Asset, Movement, Snapshot } from '../domain/types'

type NewRecord<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>

const nowIso = () => new Date().toISOString()
const newId = () => crypto.randomUUID()

/** Se avisa a quien escuche (la sincronización) de que hay cambios locales. */
const listeners = new Set<() => void>()
export const onLocalChange = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = () => listeners.forEach((fn) => fn())

export async function saveAsset(data: NewRecord<Asset>, id?: string): Promise<string> {
  const now = nowIso()
  if (id) {
    const prev = await db.assets.get(id)
    if (!prev) throw new Error('El activo ya no existe.')
    await db.assets.put({ ...prev, ...data, id, updatedAt: now })
  } else {
    id = newId()
    await db.assets.add({ ...data, id, createdAt: now, updatedAt: now })
  }
  changed()
  return id
}

export async function deleteAsset(id: string) {
  const now = nowIso()
  await db.transaction('rw', db.assets, db.movements, async () => {
    await db.assets.update(id, { deleted: true, updatedAt: now })
    const ms = await db.movements.where('assetId').equals(id).toArray()
    for (const m of ms) await db.movements.update(m.id, { deleted: true, updatedAt: now })
  })
  changed()
}

export async function saveMovement(data: NewRecord<Movement>, id?: string): Promise<string> {
  const now = nowIso()
  if (id) {
    const prev = await db.movements.get(id)
    if (!prev) throw new Error('El movimiento ya no existe.')
    await db.movements.put({ ...prev, ...data, id, updatedAt: now })
  } else {
    id = newId()
    await db.movements.add({ ...data, id, createdAt: now, updatedAt: now })
  }
  changed()
  return id
}

export async function deleteMovement(id: string) {
  await db.movements.update(id, { deleted: true, updatedAt: nowIso() })
  changed()
}

export async function exportSnapshot(): Promise<Snapshot> {
  const [assets, movements] = await Promise.all([db.assets.toArray(), db.movements.toArray()])
  return { app: 'buho', version: 1, exportedAt: nowIso(), assets, movements }
}

/** Fusiona una copia (de Drive o de un archivo) con los datos locales. */
export async function mergeIntoLocal(remote: Snapshot): Promise<Snapshot> {
  const merged = mergeSnapshots(await exportSnapshot(), remote)
  await db.transaction('rw', db.assets, db.movements, async () => {
    await db.assets.bulkPut(merged.assets)
    await db.movements.bulkPut(merged.movements)
  })
  return merged
}

export async function wipeLocalData() {
  await db.transaction('rw', db.assets, db.movements, db.meta, async () => {
    await db.assets.clear()
    await db.movements.clear()
    await db.meta.clear()
  })
}
