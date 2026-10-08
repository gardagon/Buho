import { describe, expect, it } from 'vitest'
import { computePortfolio } from './portfolio'
import type { Asset, FxRates, Movement, Quote } from './types'
import { dayChange, pickPrice, valuePositions } from './valuation'

const stamp = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const asset = (id: string, currency: string, extra: Partial<Asset> = {}): Asset => ({
  id,
  name: id,
  type: 'accion',
  currency,
  ...stamp,
  ...extra,
})
const buy = (assetId: string, quantity: string, price: string, currency: string, fxRate: string): Movement => ({
  id: `m-${assetId}`,
  assetId,
  type: 'compra',
  date: '2026-01-10',
  quantity,
  price,
  currency,
  fxRate,
  fees: '0',
  withholding: '0',
  ...stamp,
})
const quote = (assetId: string, price: string, currency: string, at: string, prevClose?: string): Quote => ({
  assetId,
  price,
  currency,
  at,
  prevClose,
  provider: 'test',
})
const fx: FxRates = { date: '2026-10-08', rates: { USD: '1.2' } }

describe('valuePositions', () => {
  it('valora en EUR con el cambio actual y calcula la plusvalía latente', () => {
    // 10 acciones a 100 USD con cambio 1,25 → coste 1000 USD / 1,25 = 800 EUR.
    // Hoy 120 USD con cambio 1,20 → 1200 / 1,2 = 1000 EUR. Latente: +200 EUR (+25 %).
    const a = asset('apple', 'USD')
    const p = computePortfolio([a], [buy('apple', '10', '100', 'USD', '1.25')])
    const v = valuePositions(p.positions, new Map([['apple', quote('apple', '120', 'USD', '2026-10-08T10:00:00Z')]]), fx)
    expect(v.rows[0].valueEur?.toString()).toBe('1000')
    expect(v.unrealizedEur.toString()).toBe('200')
    expect(v.unrealizedPct?.toString()).toBe('0.25')
    expect(v.unvalued).toBe(0)
  })

  it('sin precio no inventa valor y no mezcla su coste en el total', () => {
    const a = asset('fondo', 'EUR')
    const b = asset('iber', 'EUR')
    const p = computePortfolio([a, b], [buy('fondo', '5', '20', 'EUR', '1'), buy('iber', '10', '10', 'EUR', '1')])
    const v = valuePositions(p.positions, new Map([['iber', quote('iber', '12', 'EUR', '2026-10-08T10:00:00Z')]]))
    expect(v.unvalued).toBe(1)
    expect(v.valueEur.toString()).toBe('120')
    expect(v.costOfValuedEur.toString()).toBe('100')
    expect(v.unrealizedEur.toString()).toBe('20')
  })

  it('marca como sin valorar lo que está en una divisa sin tipo de cambio', () => {
    const a = asset('uk', 'GBP')
    const p = computePortfolio([a], [buy('uk', '1', '10', 'GBP', '0.85')])
    const v = valuePositions(p.positions, new Map([['uk', quote('uk', '11', 'GBP', '2026-10-08T10:00:00Z')]]), fx)
    expect(v.rows[0].missingFx).toBe(true)
    expect(v.unvalued).toBe(1)
  })
})

describe('pickPrice', () => {
  it('usa la cotización si el precio manual no es más reciente', () => {
    const a = asset('x', 'EUR', { manualPrice: '50', manualPriceDate: '2026-10-07' })
    expect(pickPrice(a, quote('x', '60', 'EUR', '2026-10-07T17:00:00Z'))?.source).toBe('mercado')
  })

  it('usa el precio manual si es de un día posterior', () => {
    const a = asset('x', 'EUR', { manualPrice: '50', manualPriceDate: '2026-10-08' })
    const p = pickPrice(a, quote('x', '60', 'EUR', '2026-10-07T17:00:00Z'))
    expect(p?.source).toBe('manual')
    expect(p?.price.toString()).toBe('50')
  })

  it('ignora precios cero o vacíos', () => {
    expect(pickPrice(asset('x', 'EUR', { manualPrice: '0' }))).toBeUndefined()
  })
})

describe('dayChange', () => {
  it('calcula la variación sobre el cierre anterior', () => {
    // 102 sobre 100 → +2 (+2 %)
    const p = pickPrice(asset('x', 'EUR'), quote('x', '102', 'EUR', '2026-10-08T10:00:00Z', '100'))!
    const c = dayChange(p)!
    expect(c.abs.toString()).toBe('2')
    expect(c.pct.toString()).toBe('0.02')
  })

  it('devuelve undefined sin cierre anterior', () => {
    const p = pickPrice(asset('x', 'EUR'), quote('x', '102', 'EUR', '2026-10-08T10:00:00Z'))!
    expect(dayChange(p)).toBeUndefined()
  })
})
