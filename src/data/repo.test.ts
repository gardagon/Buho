import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addPricePoint, deleteAsset, deletePricePoint, exportSnapshot, mergeIntoLocal, saveAsset, saveMovement, saveQuotes, wipeLocalData } from './repo'

const base = { currency: 'EUR', fxRate: '1', fees: '0', withholding: '0' }

describe('repo (IndexedDB)', () => {
  beforeEach(wipeLocalData)

  it('al eliminar un activo marca también sus movimientos', async () => {
    const a = await saveAsset({ name: 'Iberdrola', type: 'accion', currency: 'EUR' })
    await saveMovement({ ...base, assetId: a, type: 'compra', date: '2026-01-01', quantity: '10', price: '12' })
    await deleteAsset(a)
    const snap = await exportSnapshot()
    expect(snap.assets[0].deleted).toBe(true)
    expect(snap.movements[0].deleted).toBe(true)
  })

  it('fusiona una copia remota sin perder lo local', async () => {
    const a = await saveAsset({ name: 'Local', type: 'etf', currency: 'EUR' })
    const remote = {
      app: 'buho' as const,
      version: 1 as const,
      exportedAt: '',
      assets: [{ id: 'r1', name: 'Remoto', type: 'bono' as const, currency: 'EUR', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      movements: [],
    }
    const merged = await mergeIntoLocal(remote)
    expect(merged.assets.map((x) => x.id).sort()).toEqual([a, 'r1'].sort())
    expect(await db.assets.count()).toBe(2)
  })

  it('el histórico de precios deja como precio manual el más reciente', async () => {
    const a = await saveAsset({ name: 'Fondo', type: 'fondo', currency: 'EUR' })
    await addPricePoint(a, { date: '2026-10-01', price: '10', currency: 'EUR' })
    await addPricePoint(a, { date: '2026-10-05', price: '12', currency: 'USD', fxRate: '1.2' })
    // un precio más antiguo, añadido después, no cambia el más reciente
    await addPricePoint(a, { date: '2026-09-01', price: '9', currency: 'EUR' })
    expect(await db.assets.get(a)).toMatchObject({ manualPrice: '12', manualPriceDate: '2026-10-05', manualPriceCurrency: 'USD' })
    expect(await db.prices.where('assetId').equals(a).count()).toBe(3)
  })

  it('un segundo precio el mismo día corrige el anterior en vez de duplicarlo', async () => {
    const a = await saveAsset({ name: 'Fondo', type: 'fondo', currency: 'EUR' })
    await addPricePoint(a, { date: '2026-10-01', price: '10', currency: 'EUR' })
    await addPricePoint(a, { date: '2026-10-01', price: '11', currency: 'EUR' })
    const points = await db.prices.where('assetId').equals(a).toArray()
    expect(points).toHaveLength(1)
    expect(points[0].price).toBe('11')
  })

  it('borrar un precio marca el punto y recalcula el manual con el anterior', async () => {
    const a = await saveAsset({ name: 'Fondo', type: 'fondo', currency: 'EUR' })
    await addPricePoint(a, { date: '2026-10-01', price: '10', currency: 'EUR' })
    await addPricePoint(a, { date: '2026-10-05', price: '12', currency: 'EUR' })
    const last = (await db.prices.toArray()).find((p) => p.date === '2026-10-05')!
    await deletePricePoint(last.id)
    expect((await db.prices.get(last.id))?.deleted).toBe(true) // no se borra físicamente
    expect(await db.assets.get(a)).toMatchObject({ manualPrice: '10', manualPriceDate: '2026-10-01' })
  })

  it('el histórico viaja en la copia y se fusiona sin duplicar', async () => {
    const a = await saveAsset({ name: 'Fondo', type: 'fondo', currency: 'EUR' })
    await addPricePoint(a, { date: '2026-10-01', price: '10', currency: 'EUR' })
    const snap = await exportSnapshot()
    expect(snap.prices).toHaveLength(1)
    await mergeIntoLocal(snap)
    expect(await db.prices.count()).toBe(1)
  })

  it('al eliminar un activo se marcan también sus precios', async () => {
    const a = await saveAsset({ name: 'Fondo', type: 'fondo', currency: 'EUR' })
    await addPricePoint(a, { date: '2026-10-01', price: '10', currency: 'EUR' })
    await deleteAsset(a)
    expect((await db.prices.toArray())[0].deleted).toBe(true)
  })

  it('las cotizaciones guardan el cierre de cada día para el histórico', async () => {
    await saveQuotes([{ assetId: 'a', price: '190', currency: 'USD', at: '2026-10-08T15:00:00Z', provider: 'finnhub' }])
    await saveQuotes([{ assetId: 'a', price: '191', currency: 'USD', at: '2026-10-08T20:00:00Z', provider: 'finnhub' }])
    const days = await db.quoteDays.toArray()
    expect(days).toHaveLength(1)
    expect(days[0].price).toBe('191')
  })
})
