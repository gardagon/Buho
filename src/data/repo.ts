import { db, getMeta, setMeta } from './db'
import { mergeSnapshots } from './merge'
import type { Asset, FxRates, ISODate, Movement, PricePoint, Quote, QuoteDay, Snapshot } from '../domain/types'

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
  await db.transaction('rw', db.assets, db.movements, db.prices, async () => {
    await db.assets.update(id, { deleted: true, updatedAt: now })
    const ms = await db.movements.where('assetId').equals(id).toArray()
    for (const m of ms) await db.movements.update(m.id, { deleted: true, updatedAt: now })
    const ps = await db.prices.where('assetId').equals(id).toArray()
    for (const p of ps) await db.prices.update(p.id, { deleted: true, updatedAt: now })
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
  const [assets, movements, prices] = await Promise.all([db.assets.toArray(), db.movements.toArray(), db.prices.toArray()])
  return { app: 'buho', version: 1, exportedAt: nowIso(), assets, movements, prices }
}

/** Fusiona una copia (de Drive o de un archivo) con los datos locales. */
export async function mergeIntoLocal(remote: Snapshot): Promise<Snapshot> {
  const merged = mergeSnapshots(await exportSnapshot(), remote)
  await db.transaction('rw', db.assets, db.movements, db.prices, async () => {
    await db.assets.bulkPut(merged.assets)
    await db.movements.bulkPut(merged.movements)
    await db.prices.bulkPut(merged.prices ?? [])
  })
  return merged
}

/**
 * Cotizaciones y tipos de cambio: caché local. No llevan `updatedAt` ni
 * avisan a la sincronización porque no viajan a Drive.
 */
export const QUOTE_META = {
  finnhubKey: 'quotes.finnhubKey',
  /** Dirección del proxy de Yahoo (worker/yahoo-proxy.js). */
  yahooProxy: 'quotes.yahooProxy',
  fx: 'quotes.fx',
  refreshedAt: 'quotes.refreshedAt',
  /** Moneda principal con la que se enseñan los precios en Seguimiento. */
  baseCurrency: 'ui.baseCurrency',
  /** Qué día se intentó por última vez descargar el histórico de cada activo (para no insistir). */
  historyTried: 'quotes.historyTried',
} as const

export async function saveQuotes(quotes: Quote[]) {
  await db.quotes.bulkPut(quotes)
  // Se guarda también el último precio de cada día para dibujar el histórico.
  await db.quoteDays.bulkPut(
    quotes.map((q) => ({ assetId: q.assetId, date: q.at.slice(0, 10), price: q.price, currency: q.currency })),
  )
}

/** Guarda cierres diarios (histórico descargado). Un día ya guardado se sustituye por el nuevo. */
export async function saveQuoteDays(days: QuoteDay[]) {
  await db.quoteDays.bulkPut(days)
}

/**
 * Añade un precio al histórico del activo (o corrige el de ese mismo día) y deja
 * como precio manual del activo el más reciente.
 */
export async function addPricePoint(
  assetId: string,
  data: { date: ISODate; price: string; currency: string; fxRate?: string },
) {
  const now = nowIso()
  await db.transaction('rw', db.assets, db.prices, async () => {
    const same = (await db.prices.where('assetId').equals(assetId).toArray()).find((p) => !p.deleted && p.date === data.date)
    if (same) await db.prices.put({ ...same, ...data, updatedAt: now })
    else await db.prices.add({ ...data, assetId, id: newId(), createdAt: now, updatedAt: now })
    await syncManualPrice(assetId, now)
  })
  changed()
}

export async function deletePricePoint(id: string) {
  const now = nowIso()
  await db.transaction('rw', db.assets, db.prices, async () => {
    const p = await db.prices.get(id)
    if (!p) return
    await db.prices.update(id, { deleted: true, updatedAt: now })
    await syncManualPrice(p.assetId, now)
  })
  changed()
}

/** El precio manual del activo es siempre el del punto más reciente que no esté borrado. */
async function syncManualPrice(assetId: string, now: string) {
  const live = (await db.prices.where('assetId').equals(assetId).toArray()).filter((p) => !p.deleted)
  live.sort((a: PricePoint, b: PricePoint) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.updatedAt.localeCompare(a.updatedAt)))
  const latest = live[0]
  await db.assets.update(assetId, {
    manualPrice: latest?.price,
    manualPriceDate: latest?.date,
    manualPriceCurrency: latest?.currency,
    updatedAt: now,
  })
}

export async function saveFxRates(fx: FxRates) {
  await setMeta(QUOTE_META.fx, fx)
}

export const loadFxRates = () => getMeta<FxRates>(QUOTE_META.fx)

export async function wipeLocalData() {
  await db.transaction('rw', [db.assets, db.movements, db.meta, db.quotes, db.prices, db.quoteDays], async () => {
    await db.assets.clear()
    await db.movements.clear()
    await db.meta.clear()
    await db.quotes.clear()
    await db.prices.clear()
    await db.quoteDays.clear()
  })
}
