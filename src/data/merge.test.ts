import { describe, expect, it } from 'vitest'
import { mergeRecords, parseSnapshot } from './merge'

const r = (id: string, updatedAt: string, extra: object = {}) => ({ id, createdAt: updatedAt, updatedAt, ...extra })

describe('mergeRecords', () => {
  it('une registros de los dos lados', () => {
    const out = mergeRecords([r('a', '2026-01-01')], [r('b', '2026-01-01')])
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })

  it('gana la versión más reciente', () => {
    const out = mergeRecords(
      [r('a', '2026-01-01', { name: 'local' })],
      [r('a', '2026-02-01', { name: 'remota' })],
    )
    expect(out[0]).toMatchObject({ name: 'remota' })
  })

  it('propaga las eliminaciones', () => {
    const out = mergeRecords([r('a', '2026-01-01')], [r('a', '2026-03-01', { deleted: true })])
    expect(out[0]).toMatchObject({ deleted: true })
  })

  it('ante empate se queda la local', () => {
    const out = mergeRecords([r('a', '2026-01-01', { v: 'L' })], [r('a', '2026-01-01', { v: 'R' })])
    expect(out[0]).toMatchObject({ v: 'L' })
  })
})

describe('parseSnapshot', () => {
  it('rechaza archivos que no son de Buho', () => {
    expect(() => parseSnapshot('{"foo":1}')).toThrow()
    expect(() => parseSnapshot('no json')).toThrow()
  })
  it('acepta una copia válida', () => {
    const s = parseSnapshot(JSON.stringify({ app: 'buho', version: 1, exportedAt: '', assets: [], movements: [] }))
    expect(s.assets).toEqual([])
  })
})
