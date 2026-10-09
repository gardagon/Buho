import Dexie, { type EntityTable } from 'dexie'
import type { Asset, Movement, PricePoint, Quote, QuoteDay } from '../domain/types'

export interface MetaEntry {
  key: string
  value: unknown
}

/** Base de datos local (IndexedDB). Es la copia con la que trabaja la app. */
export class BuhoDB extends Dexie {
  assets!: EntityTable<Asset, 'id'>
  movements!: EntityTable<Movement, 'id'>
  meta!: EntityTable<MetaEntry, 'key'>
  /** Caché de la última cotización por activo. No se sincroniza. */
  quotes!: EntityTable<Quote, 'assetId'>
  /** Histórico de precios puestos a mano. Se sincroniza. */
  prices!: EntityTable<PricePoint, 'id'>
  /** Cierres diarios de las cotizaciones. Solo local. */
  quoteDays!: Dexie.Table<QuoteDay, [string, string]>

  constructor(name = 'buho') {
    super(name)
    this.version(1).stores({
      assets: 'id, name, type, updatedAt',
      movements: 'id, assetId, date, type, updatedAt',
      meta: 'key',
    })
    this.version(2).stores({ quotes: 'assetId' })
    this.version(3)
      .stores({ prices: 'id, assetId, date', quoteDays: '[assetId+date], assetId' })
      .upgrade(async (tx) => {
        // Los precios manuales que ya existían pasan a ser el primer punto del histórico.
        // El id es determinista para que, si dos dispositivos migran, la fusión no los duplique.
        const now = new Date().toISOString()
        await tx.table('assets').each(async (a: Asset) => {
          if (!a.manualPrice || a.deleted) return
          const date = a.manualPriceDate ?? now.slice(0, 10)
          await tx.table('prices').put({
            id: `migrado-${a.id}-${date}`,
            assetId: a.id,
            date,
            price: a.manualPrice,
            currency: a.manualPriceCurrency ?? a.currency,
            createdAt: now,
            updatedAt: now,
          })
        })
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
