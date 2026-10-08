import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { deleteAsset, exportSnapshot, mergeIntoLocal, saveAsset, saveMovement, wipeLocalData } from './repo'

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
})
