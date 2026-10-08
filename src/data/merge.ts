import type { Snapshot, SyncedRecord } from '../domain/types'

/**
 * Fusiona dos listas de registros por `id`. Gana la versión con `updatedAt`
 * más reciente; ante empate se queda la local. Como nada se borra
 * físicamente (se marca `deleted`), las eliminaciones también se propagan.
 */
export function mergeRecords<T extends SyncedRecord>(local: T[], remote: T[]): T[] {
  const out = new Map<string, T>()
  for (const r of remote) out.set(r.id, r)
  for (const l of local) {
    const r = out.get(l.id)
    if (!r || l.updatedAt >= r.updatedAt) out.set(l.id, l)
  }
  return [...out.values()]
}

export function mergeSnapshots(local: Snapshot, remote: Snapshot): Snapshot {
  return {
    app: 'buho',
    version: 1,
    exportedAt: new Date().toISOString(),
    assets: mergeRecords(local.assets, remote.assets),
    movements: mergeRecords(local.movements, remote.movements),
  }
}

/** Comprueba que un archivo tiene pinta de copia de Buho antes de usarlo. */
export function parseSnapshot(text: string): Snapshot {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es un JSON válido.')
  }
  const s = data as Partial<Snapshot>
  if (!s || s.app !== 'buho' || !Array.isArray(s.assets) || !Array.isArray(s.movements)) {
    throw new Error('El archivo no es una copia de Buho.')
  }
  if (s.version !== 1) {
    throw new Error(`Copia de una versión de Buho no compatible (${String(s.version)}). Actualiza la app.`)
  }
  const valid = (r: Partial<SyncedRecord>) => typeof r?.id === 'string' && typeof r?.updatedAt === 'string'
  if (!s.assets.every(valid) || !s.movements.every(valid)) {
    throw new Error('La copia tiene registros dañados.')
  }
  return s as Snapshot
}
