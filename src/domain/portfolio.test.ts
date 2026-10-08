import { describe, expect, it } from 'vitest'
import { computePortfolio, summarizeByYear } from './portfolio'
import { parseUserNumber } from './numbers'
import type { Asset, Movement } from './types'

const now = '2026-01-01T00:00:00.000Z'
const asset = (id: string, currency = 'EUR'): Asset => ({
  id, name: id, type: 'accion', currency, createdAt: now, updatedAt: now,
})
let seq = 0
const mv = (p: Partial<Movement> & Pick<Movement, 'assetId' | 'type' | 'date'>): Movement => ({
  id: `m${++seq}`, currency: 'EUR', fxRate: '1', fees: '0', withholding: '0',
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), updatedAt: now, ...p,
})

describe('computePortfolio (FIFO)', () => {
  it('suma comisiones al coste de compra', () => {
    const p = computePortfolio([asset('SAN')], [
      mv({ assetId: 'SAN', type: 'compra', date: '2026-01-10', quantity: '100', price: '4', fees: '10' }),
    ])
    expect(p.positions[0].quantity.toString()).toBe('100')
    expect(p.positions[0].costEur.toString()).toBe('410')
    expect(p.positions[0].avgCostEur.toString()).toBe('4.1')
  })

  it('vende primero los títulos más antiguos', () => {
    const p = computePortfolio([asset('ITX')], [
      mv({ assetId: 'ITX', type: 'compra', date: '2026-01-10', quantity: '10', price: '30' }),
      mv({ assetId: 'ITX', type: 'compra', date: '2026-03-10', quantity: '10', price: '40' }),
      mv({ assetId: 'ITX', type: 'venta', date: '2026-06-01', quantity: '15', price: '50', fees: '5' }),
    ])
    const sale = p.sales[0]
    // coste: 10×30 + 5×40 = 500 · ingreso: 15×50 − 5 = 745
    expect(sale.costEur.toString()).toBe('500')
    expect(sale.proceedsEur.toString()).toBe('745')
    expect(sale.gainEur.toString()).toBe('245')
    expect(sale.matched.map((m) => m.buyDate)).toEqual(['2026-01-10', '2026-03-10'])
    // quedan 5 títulos del segundo lote a 40
    expect(p.positions[0].quantity.toString()).toBe('5')
    expect(p.positions[0].costEur.toString()).toBe('200')
  })

  it('el orden de entrada no importa: manda la fecha', () => {
    const p = computePortfolio([asset('A')], [
      mv({ assetId: 'A', type: 'venta', date: '2026-05-01', quantity: '5', price: '20' }),
      mv({ assetId: 'A', type: 'compra', date: '2026-02-01', quantity: '5', price: '10' }),
    ])
    expect(p.issues).toHaveLength(0)
    expect(p.sales[0].gainEur.toString()).toBe('50')
    expect(p.positions).toHaveLength(0)
  })

  it('convierte a EUR con el tipo de cambio de cada operación', () => {
    const p = computePortfolio([asset('AAPL', 'USD')], [
      mv({ assetId: 'AAPL', type: 'compra', date: '2026-01-10', quantity: '10', price: '110', currency: 'USD', fxRate: '1.1' }),
      mv({ assetId: 'AAPL', type: 'venta', date: '2026-09-10', quantity: '10', price: '125', currency: 'USD', fxRate: '1.25' }),
    ])
    // coste 1100 USD / 1,1 = 1000 € · venta 1250 USD / 1,25 = 1000 € → 0 € de plusvalía
    // (la ganancia en dólares se la come el tipo de cambio)
    expect(p.sales[0].gainEur.toString()).toBe('0')
  })

  it('avisa si se vende más de lo que se tiene', () => {
    const p = computePortfolio([asset('A')], [
      mv({ assetId: 'A', type: 'compra', date: '2026-01-01', quantity: '5', price: '10' }),
      mv({ assetId: 'A', type: 'venta', date: '2026-02-01', quantity: '8', price: '10' }),
    ])
    expect(p.issues).toHaveLength(1)
  })

  it('ignora los registros eliminados', () => {
    const p = computePortfolio([asset('A')], [
      mv({ assetId: 'A', type: 'compra', date: '2026-01-01', quantity: '5', price: '10' }),
      mv({ assetId: 'A', type: 'compra', date: '2026-01-02', quantity: '5', price: '10', deleted: true }),
    ])
    expect(p.positions[0].quantity.toString()).toBe('5')
  })

  it('agrupa plusvalías y rendimientos por año', () => {
    const p = computePortfolio([asset('A'), asset('B')], [
      mv({ assetId: 'A', type: 'compra', date: '2025-01-01', quantity: '10', price: '10' }),
      mv({ assetId: 'A', type: 'venta', date: '2025-06-01', quantity: '10', price: '12' }),
      mv({ assetId: 'B', type: 'compra', date: '2026-01-01', quantity: '10', price: '10' }),
      mv({ assetId: 'B', type: 'venta', date: '2026-06-01', quantity: '10', price: '9' }),
      mv({ assetId: 'B', type: 'dividendo', date: '2026-03-01', amount: '20', withholding: '3.8' }),
    ])
    const [y2026, y2025] = summarizeByYear(p)
    expect(y2025.netGainEur.toString()).toBe('20')
    expect(y2026.lossesEur.toString()).toBe('-10')
    expect(y2026.incomeGrossEur.toString()).toBe('20')
    expect(y2026.withholdingEur.toString()).toBe('3.8')
  })
})

describe('computePortfolio (importe real en EUR)', () => {
  const aapl = asset('AAPL', 'USD')

  it('el total cobrado manda sobre cantidad × precio ÷ cambio', () => {
    // 10 × 117 $ ÷ 1,17 = 1000 € pero el bróker cobró 1002,50 € (comisiones y su cambio)
    const p = computePortfolio([aapl], [
      mv({ assetId: 'AAPL', type: 'compra', date: '2026-01-10', quantity: '10', price: '117', currency: 'USD', fxRate: '1.17', totalEur: '1002.5' }),
    ])
    expect(p.positions[0].costEur.toString()).toBe('1002.5')
    expect(p.positions[0].avgCostEur.toString()).toBe('100.25')
  })

  it('en la venta, lo ingresado es el valor de transmisión', () => {
    // Compra: 10 títulos por 1002,50 € → 100,25 €/título.
    // Venta de 5: 5 × 130 $ ÷ 1,30 = 500 € pero ingresan 498,75 €.
    // Coste de los 5: 501,25 € → resultado 498,75 − 501,25 = −2,50 €
    const p = computePortfolio([aapl], [
      mv({ assetId: 'AAPL', type: 'compra', date: '2026-01-10', quantity: '10', price: '117', currency: 'USD', fxRate: '1.17', totalEur: '1002.5' }),
      mv({ assetId: 'AAPL', type: 'venta', date: '2026-06-10', quantity: '5', price: '130', currency: 'USD', fxRate: '1.3', totalEur: '498.75' }),
    ])
    expect(p.sales[0].proceedsEur.toString()).toBe('498.75')
    expect(p.sales[0].costEur.toString()).toBe('501.25')
    expect(p.sales[0].gainEur.toString()).toBe('-2.5')
    expect(p.positions[0].costEur.toString()).toBe('501.25')
  })

  it('sin total sigue calculando con cantidad × precio ± comisiones', () => {
    const p = computePortfolio([aapl], [
      mv({ assetId: 'AAPL', type: 'compra', date: '2026-01-10', quantity: '10', price: '117', currency: 'USD', fxRate: '1.17' }),
    ])
    expect(p.positions[0].costEur.toString()).toBe('1000')
  })

  it('si se mezclan divisas del precio, el coste medio se da en EUR', () => {
    // Activo en USD: una compra con el precio en $ y otra con el precio en €
    const p = computePortfolio([aapl], [
      mv({ assetId: 'AAPL', type: 'compra', date: '2026-01-10', quantity: '10', price: '117', currency: 'USD', fxRate: '1.17' }),
      mv({ assetId: 'AAPL', type: 'compra', date: '2026-02-10', quantity: '10', price: '110', currency: 'EUR' }),
    ])
    // 1000 € + 1100 € = 2100 € entre 20 títulos = 105 €
    expect(p.positions[0].costCurrency).toBe('EUR')
    expect(p.positions[0].avgCost.toString()).toBe('105')
  })

  it('con una sola divisa, el coste medio sigue en la del activo', () => {
    const p = computePortfolio([aapl], [
      mv({ assetId: 'AAPL', type: 'compra', date: '2026-01-10', quantity: '10', price: '117', currency: 'USD', fxRate: '1.17' }),
    ])
    expect(p.positions[0].costCurrency).toBe('USD')
    expect(p.positions[0].avgCost.toString()).toBe('117')
  })
})

describe('parseUserNumber', () => {
  it.each([
    ['1.234,56', '1234.56'],
    ['1234,56', '1234.56'],
    ['1234.56', '1234.56'],
    ['1 234,5', '1234.5'],
    ['1,234.56', '1234.56'],
    ['1.234.567', '1234567'],
    ['0,0005', '0.0005'],
    ['', null],
    ['abc', null],
    ['1,2,3', null],
  ])('%s → %s', (input, out) => {
    expect(parseUserNumber(input)).toBe(out)
  })
})
