import { describe, expect, it } from 'vitest'
import { lotDetails } from './lots'
import { Decimal } from './numbers'
import { knownPrices, periodPerformance, priceOn, shiftDate } from './performance'
import { computePortfolio } from './portfolio'
import type { Asset, Movement } from './types'

const now = '2026-01-01T00:00:00.000Z'
const asset: Asset = { id: 'A', name: 'A', type: 'accion', currency: 'EUR', createdAt: now, updatedAt: now }
let seq = 0
const mv = (p: Partial<Movement> & Pick<Movement, 'type' | 'date'>): Movement => ({
  id: `m${++seq}`, assetId: 'A', currency: 'EUR', fxRate: '1', fees: '0', withholding: '0',
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), updatedAt: now, ...p,
})

// Compra 10 × 10 € (100 €) · compra 10 × 12 € (120 €) · venta 5 × 15 € (75 €)
const base = () => [
  mv({ type: 'compra', date: '2025-01-10', quantity: '10', price: '10' }),
  mv({ type: 'compra', date: '2026-09-20', quantity: '10', price: '12' }),
  mv({ type: 'venta', date: '2026-10-05', quantity: '5', price: '15' }),
]

describe('shiftDate', () => {
  it('resta días y meses sin pasarse de mes', () => {
    expect(shiftDate('2026-10-09', { days: 7 })).toBe('2026-10-02')
    expect(shiftDate('2026-10-09', { months: 1 })).toBe('2026-09-09')
    expect(shiftDate('2026-03-31', { months: 1 })).toBe('2026-02-28')
    expect(shiftDate('2024-02-29', { months: 12 })).toBe('2023-02-28')
    expect(shiftDate('2026-10-09', { months: 60 })).toBe('2021-10-09')
  })
})

describe('periodPerformance', () => {
  // Hoy 2026-10-09 · quedan 15 títulos a 14 € → valen 210 €
  const run = (movements: Movement[], extra: Partial<Parameters<typeof periodPerformance>[0]> = {}) =>
    periodPerformance({
      movements,
      today: '2026-10-09',
      valueNowEur: new Decimal(210),
      prices: knownPrices(movements, [], []),
      ...extra,
    })

  it('1 semana: tenía 20 títulos a 12 € y vendió 5 por 75 €', () => {
    // valor entonces 20 × 12 = 240 · beneficio = 210 − 240 + 75 = 45 · sobre 240 = 18,75 %
    const r = run(base()).find((x) => x.id === '1s')!
    expect(r.sharesThen.toString()).toBe('20')
    expect(r.valueThenEur?.toString()).toBe('240')
    expect(r.profitEur?.toString()).toBe('45')
    expect(r.pct?.toFixed(4)).toBe('0.1875')
  })

  it('1 mes: tenía 10 títulos (último precio conocido 10 €), compró 120 € y vendió 75 €', () => {
    // valor entonces 100 · beneficio = 210 − 100 − 120 + 75 = 65 · sobre 100 + 120 = 29,55 %
    const r = run(base()).find((x) => x.id === '1m')!
    expect(r.sharesThen.toString()).toBe('10')
    expect(r.priceThen?.date).toBe('2025-01-10')
    expect(r.profitEur?.toString()).toBe('65')
    expect(r.pct?.toFixed(4)).toBe('0.2955')
  })

  it('si aún no tenía el valor, todo lo comprado cuenta como aportación', () => {
    // 5 años: 0 títulos entonces · compras 220 · ventas 75 → 210 − 220 + 75 = 65 sobre 220
    const r = run(base()).find((x) => x.id === '5a')!
    expect(r.sharesThen.toString()).toBe('0')
    expect(r.profitEur?.toString()).toBe('65')
    expect(r.pct?.toFixed(4)).toBe('0.2955')
  })

  it('suma los dividendos cobrados en el periodo', () => {
    // dividendo de 8 € con 1 € de retención hace 3 días → +7 € al beneficio de 1 semana (45 → 52)
    const ms = [...base(), mv({ type: 'dividendo', date: '2026-10-06', amount: '8', withholding: '1' })]
    const r = run(ms).find((x) => x.id === '1s')!
    expect(r.incomeEur.toString()).toBe('7')
    expect(r.profitEur?.toString()).toBe('52')
  })

  it('sin precio conocido de esa fecha no inventa el beneficio', () => {
    const r = run(base(), { prices: [] }).find((x) => x.id === '1s')!
    expect(r.status).toBe('sin-precio')
    expect(r.profitEur).toBeUndefined()
  })

  it('sin precio actual no calcula el beneficio', () => {
    const r = run(base(), { valueNowEur: undefined }).find((x) => x.id === '1s')!
    expect(r.status).toBe('sin-precio-actual')
  })
})

describe('knownPrices', () => {
  it('el precio manual gana al de mercado y este al de un movimiento del mismo día', () => {
    const ms = [mv({ type: 'compra', date: '2026-10-01', quantity: '1', price: '10' })]
    const market = [{ assetId: 'A', date: '2026-10-01', price: '11', currency: 'EUR' }]
    const manual = [{ id: 'p', assetId: 'A', date: '2026-10-01', price: '12', currency: 'EUR', createdAt: '', updatedAt: '' }]
    expect(knownPrices(ms, [], []).map((p) => [p.eur.toString(), p.source])).toEqual([['10', 'movimiento']])
    expect(knownPrices(ms, [], market).map((p) => [p.eur.toString(), p.source])).toEqual([['11', 'mercado']])
    expect(knownPrices(ms, manual, market).map((p) => [p.eur.toString(), p.source])).toEqual([['12', 'manual']])
  })

  it('priceOn devuelve el último precio de esa fecha o anterior', () => {
    const prices = knownPrices(base(), [], [])
    expect(priceOn(prices, '2026-09-19')?.eur.toString()).toBe('10')
    expect(priceOn(prices, '2026-09-20')?.eur.toString()).toBe('12')
    expect(priceOn(prices, '2024-01-01')).toBeUndefined()
  })
})

describe('lotDetails', () => {
  it('reparte cada venta entre las compras de las que sale (FIFO)', () => {
    // Compra A: 10 × 10 € = 100 € · Compra B: 10 × 12 € = 120 €
    // Venta de 15 × 20 € con 3 € de comisión → ingreso 297 €
    //   de A salen 10: 297 × 10/15 = 198 € → beneficio 98 € (98 %)
    //   de B salen 5:  297 ×  5/15 =  99 € contra 60 € → beneficio 39 € (65 %)
    const ms = [
      mv({ type: 'compra', date: '2025-01-10', quantity: '10', price: '10' }),
      mv({ type: 'compra', date: '2026-02-10', quantity: '10', price: '12' }),
      mv({ type: 'venta', date: '2026-06-01', quantity: '15', price: '20', fees: '3' }),
    ]
    const lots = lotDetails(computePortfolio([asset], ms), 'A', ms)
    const [a, b] = lots
    expect(a.status).toBe('vendida')
    expect(a.slices[0].quantity.toString()).toBe('10')
    expect(a.slices[0].proceedsEur.toString()).toBe('198')
    expect(a.slices[0].profitEur.toString()).toBe('98')
    expect(a.slices[0].profitPct?.toString()).toBe('0.98')
    expect(b.status).toBe('parcial')
    expect(b.remaining.toString()).toBe('5')
    expect(b.slices[0].proceedsEur.toString()).toBe('99')
    expect(b.slices[0].costEur.toString()).toBe('60')
    expect(b.slices[0].profitEur.toString()).toBe('39')
    expect(b.slices[0].profitPct?.toString()).toBe('0.65')
  })

  it('una compra vendida en varias ventas muestra cada una por separado', () => {
    // Compra 10 × 10 € · venta de 4 × 15 € (60 €) y venta de 6 × 8 € (48 €)
    //   1.ª: 60 − 40 = +20 € (+50 %) · 2.ª: 48 − 60 = −12 € (−20 %)
    const ms = [
      mv({ type: 'compra', date: '2025-01-10', quantity: '10', price: '10' }),
      mv({ type: 'venta', date: '2026-03-01', quantity: '4', price: '15' }),
      mv({ type: 'venta', date: '2026-04-01', quantity: '6', price: '8' }),
    ]
    const [lot] = lotDetails(computePortfolio([asset], ms), 'A', ms)
    expect(lot.slices.map((s) => [s.date, s.quantity.toString(), s.profitEur.toString(), s.profitPct?.toString()])).toEqual([
      ['2026-03-01', '4', '20', '0.5'],
      ['2026-04-01', '6', '-12', '-0.2'],
    ])
    expect(lot.realizedProfitEur.toString()).toBe('8')
    expect(lot.status).toBe('vendida')
  })

  it('una compra sin ventas está abierta y conserva todos los títulos', () => {
    const ms = [mv({ type: 'compra', date: '2025-01-10', quantity: '10', price: '10', fees: '2' })]
    const [lot] = lotDetails(computePortfolio([asset], ms), 'A', ms)
    expect(lot.status).toBe('abierta')
    expect(lot.remaining.toString()).toBe('10')
    expect(lot.costEur.toString()).toBe('102')
    expect(lot.unitCostEur.toString()).toBe('10.2')
  })
})
