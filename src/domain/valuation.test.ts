import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { computePortfolio } from './portfolio'
import type { Asset, FxRates, Movement, Quote } from './types'
import { convertAmount, counterPrice, dayChange, displayPrice, pickPrice, priceHistory, valuePositions } from './valuation'

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

describe('precio manual en otra divisa', () => {
  it('respeta la divisa del precio manual y se valora con el cambio actual', () => {
    // Activo en EUR con precio manual de Investing en dólares: 120 $ ÷ 1,2 = 100 € por título
    const a = asset('etf', 'EUR', { manualPrice: '120', manualPriceCurrency: 'USD', manualPriceDate: '2026-10-08' })
    const p = computePortfolio([a], [buy('etf', '10', '90', 'EUR', '1')])
    const v = valuePositions(p.positions, new Map(), fx)
    expect(v.rows[0].price?.currency).toBe('USD')
    expect(v.rows[0].valueEur?.toString()).toBe('1000')
  })
})

describe('counterPrice', () => {
  it('un precio en dólares se ve también en euros', () => {
    // 120 $ ÷ 1,2 = 100 €
    const c = counterPrice(pickPrice(asset('x', 'USD', { manualPrice: '120', manualPriceDate: '2026-10-08' }))!, fx)
    expect(c?.currency).toBe('EUR')
    expect(c?.amount.toString()).toBe('100')
  })

  it('un precio en euros se ve también en dólares', () => {
    // 100 € × 1,2 = 120 $
    const c = counterPrice(pickPrice(asset('x', 'EUR', { manualPrice: '100', manualPriceDate: '2026-10-08' }))!, fx)
    expect(c?.currency).toBe('USD')
    expect(c?.amount.toString()).toBe('120')
  })

  it('sin tipo de cambio no inventa nada', () => {
    const p = pickPrice(asset('x', 'GBP', { manualPrice: '10', manualPriceDate: '2026-10-08' }))!
    expect(counterPrice(p, fx)).toBeUndefined()
  })
})

describe('priceHistory', () => {
  const point = (date: string, price: string, currency: string, fxRate?: string) => ({
    id: date + currency, assetId: 'x', date, price, currency, fxRate, createdAt: '', updatedAt: '',
  })

  it('pasa a euros con el cambio de cada día, si se guardó', () => {
    // 125 $ con cambio de ese día 1,25 → 100 € · 120 $ sin cambio guardado usa el actual 1,2 → 100 €
    const h = priceHistory([point('2026-09-01', '125', 'USD', '1.25'), point('2026-10-01', '120', 'USD')], [], fx)
    expect(h.map((x) => x.eur.toString())).toEqual(['100', '100'])
  })

  it('ordena por fecha y, si un día tiene cotización y precio manual, gana el manual', () => {
    const market = [
      { assetId: 'x', date: '2026-10-02', price: '90', currency: 'EUR' },
      { assetId: 'x', date: '2026-10-01', price: '80', currency: 'EUR' },
    ]
    const h = priceHistory([point('2026-10-02', '95', 'EUR')], market, fx)
    expect(h.map((x) => [x.date, x.eur.toString(), x.source])).toEqual([
      ['2026-10-01', '80', 'mercado'],
      ['2026-10-02', '95', 'manual'],
    ])
  })

  it('deja fuera los puntos borrados y los de divisas sin cambio', () => {
    const h = priceHistory([{ ...point('2026-10-01', '10', 'EUR'), deleted: true }, point('2026-10-02', '10', 'GBP')], [], fx)
    expect(h).toEqual([])
  })
})

describe('moneda principal', () => {
  const eurPrice = () => pickPrice(asset('x', 'EUR', { manualPrice: '100', manualPriceDate: '2026-10-08' }))!
  const usdPrice = () => pickPrice(asset('x', 'USD', { manualPrice: '120', manualPriceDate: '2026-10-08' }))!

  it('un precio en dólares con euros como principal: 120 $ ÷ 1,2 = 100 €, y debajo los dólares', () => {
    const r = displayPrice(usdPrice(), 'EUR', fx)
    expect([r.main.amount.toString(), r.main.currency]).toEqual(['100', 'EUR'])
    expect([r.other?.amount.toString(), r.other?.currency]).toEqual(['120', 'USD'])
  })

  it('un precio en euros con dólares como principal: 100 € × 1,2 = 120 $, y debajo los euros', () => {
    const r = displayPrice(eurPrice(), 'USD', fx)
    expect([r.main.amount.toString(), r.main.currency]).toEqual(['120', 'USD'])
    expect([r.other?.amount.toString(), r.other?.currency]).toEqual(['100', 'EUR'])
  })

  it('sin cambio para convertir, se enseña tal cual y sin equivalente', () => {
    const r = displayPrice(pickPrice(asset('x', 'GBP', { manualPrice: '10', manualPriceDate: '2026-10-08' }))!, 'EUR', fx)
    expect([r.main.amount.toString(), r.main.currency]).toEqual(['10', 'GBP'])
    expect(r.other).toBeUndefined()
  })

  it('convertAmount pasa por el euro y respeta la misma divisa', () => {
    expect(convertAmount(new Decimal(5), 'USD', 'USD', fx)?.toString()).toBe('5')
    expect(convertAmount(new Decimal(120), 'USD', 'EUR', fx)?.toString()).toBe('100')
    expect(convertAmount(new Decimal(100), 'EUR', 'USD', fx)?.toString()).toBe('120')
    expect(convertAmount(new Decimal(1), 'GBP', 'EUR', fx)).toBeUndefined()
  })
})
