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

describe('traspaso entre fondos (art. 94 LIRPF)', () => {
  const A = asset('A')
  const B = asset('B')

  it('no tributa y el fondo de destino hereda fecha y coste de los lotes de origen', () => {
    // A: 100 part. a 10 € (1-ene-2024, coste 1.000) y 100 a 12 € (1-jun-2024, coste 1.200).
    // Traspaso de 150 part. de A a B, que entrega 75 part. (el valor liquidativo de B es el doble).
    // FIFO en A: salen 100 del primer lote (coste 1.000) y 50 del segundo (coste 600).
    // B recibe 75 × 100/150 = 50 part. con coste 1.000 (20 €/part.) y 75 × 50/150 = 25 part. con coste 600 (24 €/part.).
    const p = computePortfolio([A, B], [
      mv({ assetId: 'A', type: 'compra', date: '2024-01-01', quantity: '100', price: '10' }),
      mv({ assetId: 'A', type: 'compra', date: '2024-06-01', quantity: '100', price: '12' }),
      mv({ assetId: 'A', type: 'traspaso', date: '2025-03-01', quantity: '150', toAssetId: 'B', toQuantity: '75' }),
    ])
    expect(p.issues).toEqual([])
    expect(p.sales).toEqual([])
    const a = p.positions.find((x) => x.asset.id === 'A')!
    const b = p.positions.find((x) => x.asset.id === 'B')!
    expect([a.quantity.toString(), a.costEur.toString()]).toEqual(['50', '600'])
    expect([b.quantity.toString(), b.costEur.toString()]).toEqual(['75', '1600'])
    expect(b.lots.map((l) => [l.date, l.quantity.toString(), l.unitCostEur.toString()])).toEqual([
      ['2024-01-01', '50', '20'],
      ['2024-06-01', '25', '24'],
    ])
  })

  it('al vender desde el fondo de destino se usan las fechas y el coste heredados (FIFO)', () => {
    // Continuación: vende 60 part. de B a 30 € el 1-jul-2025. FIFO: 50 a 20 € (coste 1.000) y 10 a 24 € (coste 240).
    // Ingreso 60 × 30 = 1.800; coste 1.240; ganancia 560. Quedan 15 part. con coste 15 × 24 = 360.
    const p = computePortfolio([A, B], [
      mv({ assetId: 'A', type: 'compra', date: '2024-01-01', quantity: '100', price: '10' }),
      mv({ assetId: 'A', type: 'compra', date: '2024-06-01', quantity: '100', price: '12' }),
      mv({ assetId: 'A', type: 'traspaso', date: '2025-03-01', quantity: '150', toAssetId: 'B', toQuantity: '75' }),
      mv({ assetId: 'B', type: 'venta', date: '2025-07-01', quantity: '60', price: '30' }),
    ])
    const sale = p.sales[0]
    expect(sale.proceedsEur.toString()).toBe('1800')
    expect(sale.costEur.toString()).toBe('1240')
    expect(sale.gainEur.toString()).toBe('560')
    expect(sale.matched.map((m) => [m.buyDate, m.quantity.toString()])).toEqual([['2024-01-01', '50'], ['2024-06-01', '10']])
    const b = p.positions.find((x) => x.asset.id === 'B')!
    expect([b.quantity.toString(), b.costEur.toString()]).toEqual(['15', '360'])
  })

  it('los lotes heredados se ordenan por su fecha original frente a compras propias del destino', () => {
    // B ya tenía 10 part. compradas en 2024-09-01 a 50 €. Llegan por traspaso 10 part. de A compradas en 2024-01-01 (coste 100).
    // Al vender 10 part. de B salen primero las heredadas (más antiguas): coste 100, no 500.
    const p = computePortfolio([A, B], [
      mv({ assetId: 'A', type: 'compra', date: '2024-01-01', quantity: '10', price: '10' }),
      mv({ assetId: 'B', type: 'compra', date: '2024-09-01', quantity: '10', price: '50' }),
      mv({ assetId: 'A', type: 'traspaso', date: '2025-01-01', quantity: '10', toAssetId: 'B', toQuantity: '10' }),
      mv({ assetId: 'B', type: 'venta', date: '2025-02-01', quantity: '10', price: '60' }),
    ])
    expect(p.sales[0].costEur.toString()).toBe('100')
    expect(p.sales[0].gainEur.toString()).toBe('500')
  })

  it('avisa si se traspasa más de lo que hay o falta el fondo de destino', () => {
    const p = computePortfolio([A, B], [
      mv({ assetId: 'A', type: 'compra', date: '2024-01-01', quantity: '10', price: '10' }),
      mv({ assetId: 'A', type: 'traspaso', date: '2025-01-01', quantity: '15', toAssetId: 'B', toQuantity: '15' }),
      mv({ assetId: 'A', type: 'traspaso', date: '2025-01-02', quantity: '1', toQuantity: '1' }),
    ])
    expect(p.issues.map((i) => i.message)).toEqual([
      'Traspasas 15 participaciones pero solo tenías 10. Revisa las compras anteriores.',
      'El traspaso necesita un fondo de destino distinto del de origen.',
    ])
  })
})
})
