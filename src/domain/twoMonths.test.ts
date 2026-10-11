import { describe, expect, it } from 'vitest'
import { computePortfolio } from './portfolio'
import { addMonths, computeTwoMonthRule, openLossWindows } from './twoMonths'
import type { Asset, Movement } from './types'

const now = '2026-01-01T00:00:00.000Z'
const asset = (type: Asset['type'] = 'accion'): Asset => ({ id: 'A', name: 'A', type, currency: 'EUR', createdAt: now, updatedAt: now })
let seq = 0
const mv = (p: Partial<Movement> & Pick<Movement, 'type' | 'date'>): Movement => ({
  id: `m${++seq}`, assetId: 'A', currency: 'EUR', fxRate: '1', fees: '0', withholding: '0',
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), updatedAt: now, ...p,
})
const run = (a: Asset, ms: Movement[]) => {
  const p = computePortfolio([a], ms)
  return { p, r: computeTwoMonthRule(p, ms) }
}
const sale = (r: ReturnType<typeof run>['r'], ms: Movement[], i: number) => r.bySale.get(ms.filter((m) => m.type === 'venta')[i].id)!

describe('regla de los dos meses', () => {
  it('suma meses con el último día del mes si hace falta', () => {
    expect(addMonths('2026-03-10', 2)).toBe('2026-05-10')
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28')
    expect(addMonths('2026-03-10', -2)).toBe('2026-01-10')
  })

  it('recompra parcial posterior: difiere en proporción y lo recupera al vender lo recomprado', () => {
    // Compra 100 a 10 (coste 1.000). Vende 100 a 8 el 10-mar: pérdida 200.
    // Recompra 40 a 8 el 20-mar (dentro de 2 meses): se difiere 200 × 40/100 = 80.
    const ms = [
      mv({ type: 'compra', date: '2026-01-05', quantity: '100', price: '10' }),
      mv({ type: 'venta', date: '2026-03-10', quantity: '100', price: '8' }),
      mv({ type: 'compra', date: '2026-03-20', quantity: '40', price: '8' }),
      // Vende esos 40 a 9: coste 320, ingreso 360, ganancia 40 y se recupera la pérdida de 80.
      mv({ type: 'venta', date: '2026-07-01', quantity: '40', price: '9' }),
    ]
    const { r } = run(asset(), ms)
    expect(sale(r, ms, 0).deferredEur.toString()).toBe('80')
    expect(sale(r, ms, 0).releasedEur.toString()).toBe('0')
    expect(sale(r, ms, 1).deferredEur.toString()).toBe('0')
    expect(sale(r, ms, 1).releasedEur.toString()).toBe('80')
  })

  it('los títulos comprados antes de la venta y que siguen en cartera también cuentan', () => {
    // Compra 100 a 10 (1-ene) y 50 a 9 (20-feb). Vende 100 a 8 el 10-mar (FIFO: sale el primer lote): pérdida 200.
    // Quedan 50 comprados 18 días antes: se difiere 200 × 50/100 = 100.
    const ms = [
      mv({ type: 'compra', date: '2026-01-05', quantity: '100', price: '10' }),
      mv({ type: 'compra', date: '2026-02-20', quantity: '50', price: '9' }),
      mv({ type: 'venta', date: '2026-03-10', quantity: '100', price: '8' }),
    ]
    const { r } = run(asset(), ms)
    expect(sale(r, ms, 0).deferredEur.toString()).toBe('100')
  })

  it('la ventana llega hasta el mismo día dos meses después, ambos incluidos', () => {
    const base = [
      mv({ type: 'compra', date: '2026-01-05', quantity: '10', price: '10' }),
      mv({ type: 'venta', date: '2026-03-10', quantity: '10', price: '8' }),
    ]
    const dentro = [...base, mv({ type: 'compra', date: '2026-05-10', quantity: '10', price: '8' })]
    const fuera = [...base, mv({ type: 'compra', date: '2026-05-11', quantity: '10', price: '8' })]
    expect(sale(run(asset(), dentro).r, dentro, 0).deferredEur.toString()).toBe('20')
    expect(sale(run(asset(), fuera).r, fuera, 0).deferredEur.toString()).toBe('0')
  })

  it('una venta con ganancia no se difiere', () => {
    const ms = [
      mv({ type: 'compra', date: '2026-01-05', quantity: '10', price: '10' }),
      mv({ type: 'venta', date: '2026-03-10', quantity: '10', price: '12' }),
      mv({ type: 'compra', date: '2026-03-15', quantity: '10', price: '12' }),
    ]
    expect(sale(run(asset(), ms).r, ms, 0).deferredEur.toString()).toBe('0')
  })

  it('en fondos la ventana es de un año y en criptomonedas no se aplica', () => {
    const mk = () => [
      mv({ type: 'compra', date: '2026-01-05', quantity: '10', price: '10' }),
      mv({ type: 'venta', date: '2026-03-10', quantity: '10', price: '8' }),
      mv({ type: 'compra', date: '2026-12-01', quantity: '10', price: '8' }), // 8 meses después
    ]
    const f = mk()
    expect(sale(run(asset('fondo'), f).r, f, 0).deferredEur.toString()).toBe('20')
    const c = mk()
    expect(sale(run(asset('cripto'), c).r, c, 0).deferredEur.toString()).toBe('0')
    const a = mk()
    expect(sale(run(asset(), a).r, a, 0).deferredEur.toString()).toBe('0')
  })

  it('unos mismos títulos no respaldan dos pérdidas a la vez, y al venderlos se recupera lo diferido', () => {
    // Compra 30 a 10. Vende 10 a 8 el 1-mar (pérdida 20) y otros 10 a 8 el 5-mar (pérdida 20). Quedan 10.
    // Venta 1: los 20 que siguen en cartera (comprados en la ventana) respaldan toda su pérdida: se difieren 20.
    // Venta 2: recupera esos 20 (se venden títulos que respaldaban la primera) y los 10 que quedan respaldan su propia pérdida: difiere 20.
    const ms = [
      mv({ type: 'compra', date: '2026-01-05', quantity: '30', price: '10' }),
      mv({ type: 'venta', date: '2026-03-01', quantity: '10', price: '8' }),
      mv({ type: 'venta', date: '2026-03-05', quantity: '10', price: '8' }),
    ]
    const { r } = run(asset(), ms)
    expect(sale(r, ms, 0).deferredEur.toString()).toBe('20')
    expect(sale(r, ms, 0).releasedEur.toString()).toBe('0')
    expect(sale(r, ms, 1).releasedEur.toString()).toBe('20')
    expect(sale(r, ms, 1).deferredEur.toString()).toBe('20')
  })

  it('sin títulos en cartera al final, lo computado suma la pérdida real', () => {
    // Vende todo en dos veces: la pérdida diferida de la primera se recupera en la segunda y nada queda pendiente.
    const ms = [
      mv({ type: 'compra', date: '2026-01-05', quantity: '20', price: '10' }),
      mv({ type: 'venta', date: '2026-03-01', quantity: '10', price: '8' }),
      mv({ type: 'venta', date: '2026-03-05', quantity: '10', price: '8' }),
    ]
    const { p, r } = run(asset(), ms)
    const taxable = p.sales.map((s) => {
      const x = r.bySale.get(s.movementId)!
      return s.gainEur.plus(x.deferredEur).minus(x.releasedEur)
    })
    expect(taxable.map((v) => v.toString())).toEqual(['0', '-40'])
  })

  it('avisa de hasta cuándo no recomprar y cuántos días faltan', () => {
    const ms = [
      mv({ type: 'compra', date: '2026-01-05', quantity: '10', price: '10' }),
      mv({ type: 'venta', date: '2026-03-10', quantity: '10', price: '8' }),
    ]
    const { r } = run(asset(), ms)
    const [w] = openLossWindows(r, '2026-04-01')
    expect(w.lossEur.toString()).toBe('20')
    expect(w.until).toBe('2026-05-10')
    expect(w.safeFrom).toBe('2026-05-11')
    expect(w.daysLeft).toBe(40)
    expect(openLossWindows(r, '2026-05-11')).toEqual([])
  })

  it('un fondo vendido del todo mantiene su ventana abierta un año y desaparece al cumplirse', () => {
    const ms = [
      mv({ type: 'compra', date: '2026-01-05', quantity: '10', price: '10' }),
      mv({ type: 'venta', date: '2026-03-10', quantity: '10', price: '8' }),
    ]
    const { p, r } = run(asset('fondo'), ms)
    expect(p.positions).toEqual([]) // ya no hay títulos en cartera
    const [w] = openLossWindows(r, '2026-12-01')
    expect(w.months).toBe(12)
    expect(w.until).toBe('2027-03-10')
    expect(w.safeFrom).toBe('2027-03-11')
    expect(w.daysLeft).toBe(100)
    // Pasado el último día de la ventana, desaparece.
    expect(openLossWindows(r, '2027-03-10')).toHaveLength(1)
    expect(openLossWindows(r, '2027-03-11')).toEqual([])
  })
})
