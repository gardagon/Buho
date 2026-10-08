import Dexie, { type EntityTable } from 'dexie'
import type { Asset, Movement } from '../domain/types'

export interface MetaEntry {
  key: string
  value: unknown
}

/** Base de datos local (IndexedDB). Es la copia con la que trabaja la app. */
export class BuhoDB extends Dexie {
  assets!: EntityTable<Asset, 'id'>
  movements!: EntityTable<Movement, 'id'>
  meta!: EntityTable<MetaEntry, 'key'>

  constructor(name = 'buho') {
    super(name)
    this.version(1).stores({
      assets: 'id, name, type, updatedAt',
      movements: 'id, assetId, date, type, updatedAt',
      meta: 'key',
    })
  }
}

export const db = new BuhoDB()

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}
