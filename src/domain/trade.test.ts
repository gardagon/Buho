import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { completeTrade } from './trade'

const D = (v: string) => new Decimal(v)

describe('completeTrade', () => {
  it('compra en EUR: del total pagado salen las comisiones y el precio medio real', () => {
    // 10 × 50 = 500 € · pagados 501,50 € → comisiones 1,50 € · 50,15 €/título
    const r = completeTrade({ type: 'compra', currency: 'EUR', quantity: D('10'), price: D('50'), totalEur: D('501.5') })
    expect(r.feesEur?.toString()).toBe('1.5')
    expect(r.derived.feesEur).toBe(true)
    expect(r.perShareEur?.toString()).toBe('50.15')
  })

  it('compra con precio en dólares y cobro en euros', () => {
    // 10 × 117 $ ÷ 1,17 = 1000 € · cobrados 1002,50 € → comisiones 2,50 €
    const r = completeTrade({
      type: 'compra', currency: 'USD', quantity: D('10'), price: D('117'), fxRate: D('1.17'), totalEur: D('1002.5'),
    })
    expect(r.feesEur?.toString()).toBe('2.5')
    expect(r.perShareEur?.toString()).toBe('100.25')
  })

  it('sin cambio ni comisiones deduce el cambio efectivo', () => {
    // 10 × 117 $ = 1170 $ y cobran 1005 € → 1170 ÷ 1005 = 1,164179 $/€
    const r = completeTrade({ type: 'compra', currency: 'USD', quantity: D('10'), price: D('117'), totalEur: D('1005') })
    expect(r.fxRate?.toString()).toBe('1.164179')
    expect(r.derived.fxRate).toBe(true)
  })

  it('con comisiones conocidas, el cambio deducido las descuenta', () => {
    // cobran 1005 € con 5 € de comisión → 1000 € de valor → 1170 ÷ 1000 = 1,17
    const r = completeTrade({
      type: 'compra', currency: 'USD', quantity: D('10'), price: D('117'), feesEur: D('5'), totalEur: D('1005'),
    })
    expect(r.fxRate?.toString()).toBe('1.17')
  })

  it('venta: las comisiones son lo que falta hasta el ingreso', () => {
    // 10 × 60 = 600 € · ingresan 598,80 € → comisiones 1,20 €
    const r = completeTrade({ type: 'venta', currency: 'EUR', quantity: D('10'), price: D('60'), totalEur: D('598.8') })
    expect(r.feesEur?.toString()).toBe('1.2')
    expect(r.perShareEur?.toString()).toBe('59.88')
  })

  it('sin precio lo despeja del total y las comisiones', () => {
    // cobran 1002,50 € con 2,50 € de comisión → 1000 € / 10 títulos = 100 €
    const r = completeTrade({ type: 'compra', currency: 'EUR', quantity: D('10'), feesEur: D('2.5'), totalEur: D('1002.5') })
    expect(r.price?.toString()).toBe('100')
    expect(r.derived.price).toBe(true)
  })

  it('sin total lo calcula con las comisiones puestas', () => {
    // 10 × 50 + 1,50 = 501,50 €
    const r = completeTrade({ type: 'compra', currency: 'EUR', quantity: D('10'), price: D('50'), feesEur: D('1.5') })
    expect(r.totalEur?.toString()).toBe('501.5')
    expect(r.derived.totalEur).toBe(true)
  })

  it('avisa si el total es menor que cantidad × precio en una compra', () => {
    // 10 × 50 = 500 € y cobran 499 € → imposible con comisiones
    const r = completeTrade({ type: 'compra', currency: 'EUR', quantity: D('10'), price: D('50'), totalEur: D('499') })
    expect(r.inconsistent).toBe(true)
    expect(r.feesEur).toBeUndefined()
  })

  it('avisa si todo está puesto y no cuadra', () => {
    // 500 + 1 = 501 € pero el total dice 503 € → diferencia de 2 €
    const r = completeTrade({
      type: 'compra', currency: 'EUR', quantity: D('10'), price: D('50'), feesEur: D('1'), totalEur: D('503'),
    })
    expect(r.mismatchEur?.toString()).toBe('2')
  })

  it('sin cantidad no calcula nada', () => {
    const r = completeTrade({ type: 'compra', currency: 'EUR', price: D('50'), totalEur: D('501') })
    expect(r.feesEur).toBeUndefined()
    expect(r.derived).toEqual({})
  })
})
