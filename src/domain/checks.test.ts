import { describe, expect, it } from 'vitest'
import { checkTradePrice } from './checks'
import type { Movement, QuoteDay } from './types'

const m = (price: string, currency = 'EUR', type: Movement['type'] = 'compra'): Movement => ({
  id: 'm', assetId: 'A', type, date: '2026-10-08', quantity: '10', price, currency, fxRate: '1', fees: '0', withholding: '0',
  createdAt: '', updatedAt: '',
})
// Ese día cotizó entre 4,40 € y 4,60 €
const day: QuoteDay = { assetId: 'A', date: '2026-10-08', price: '4.52', currency: 'EUR', high: '4.60', low: '4.40' }

describe('checkTradePrice', () => {
  it('un precio dentro del rango del día cuadra', () => {
    expect(checkTradePrice(m('4.50'), day).status).toBe('ok')
    expect(checkTradePrice(m('4.40'), day).status).toBe('ok')
  })

  it('tolera un 1 % por encima y por debajo', () => {
    // 4,60 × 1,01 = 4,646 · 4,40 × 0,99 = 4,356
    expect(checkTradePrice(m('4.64'), day).status).toBe('ok')
    expect(checkTradePrice(m('4.36'), day).status).toBe('ok')
    expect(checkTradePrice(m('4.65'), day).status).toBe('fuera')
    expect(checkTradePrice(m('4.35'), day).status).toBe('fuera')
  })

  it('caza un precio con la coma mal puesta', () => {
    expect(checkTradePrice(m('45.2'), day)).toMatchObject({ status: 'fuera', low: '4.40', high: '4.60' })
  })

  it('no compara si faltan datos o la divisa es otra', () => {
    expect(checkTradePrice(m('4.50')).status).toBe('sin-datos')
    expect(checkTradePrice(m('4.50', 'USD'), day).status).toBe('sin-datos')
    expect(checkTradePrice(m('4.50'), { ...day, high: undefined }).status).toBe('sin-datos')
    expect(checkTradePrice({ ...m('4.50'), type: 'dividendo', price: undefined }, day).status).toBe('sin-datos')
  })
})
