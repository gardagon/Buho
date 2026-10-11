import { describe, expect, it } from 'vitest'
import { impliedIncomeFx, incomeBreakdown } from './income'
import { Decimal } from './numbers'
import type { Movement } from './types'

const now = '2026-01-01T00:00:00.000Z'
const div = (p: Partial<Movement>): Movement => ({
  id: 'd1', assetId: 'a', type: 'dividendo', date: '2026-03-10', amount: '0', currency: 'EUR', fxRate: '1',
  fees: '0', withholding: '0', createdAt: now, updatedAt: now, ...p,
})
const eurs = (b: ReturnType<typeof incomeBreakdown>) => ({
  gross: b.grossEur.toFixed(2), origin: b.originEur.toFixed(2), dest: b.destEur.toFixed(2),
  other: b.unclassifiedEur.toFixed(2), net: b.netEur.toFixed(2),
})

describe('incomeBreakdown', () => {
  it('un dividendo antiguo con una sola retención se queda como retención sin clasificar', () => {
    // 10 € brutos, 1,90 € retenidos → 8,10 € netos.
    const b = incomeBreakdown(div({ amount: '10', withholding: '1.90' }))
    expect(eurs(b)).toEqual({ gross: '10.00', origin: '0.00', dest: '0.00', other: '1.90', net: '8.10' })
  })

  it('retención en origen en dólares y en España en euros, cada una con su divisa', () => {
    // 100 $ brutos a 1,25 $/€ = 80 €. Origen: 15 $ = 12 €. España: 3 € (sobre lo ya retenido). Neto = 80 − 12 − 3 = 65 €.
    const b = incomeBreakdown(
      div({ amount: '100', currency: 'USD', fxRate: '1.25', withholdingOrigin: '15', withholdingOriginCurrency: 'USD', withholdingDest: '3', withholdingDestCurrency: 'EUR' }),
    )
    expect(eurs(b)).toEqual({ gross: '80.00', origin: '12.00', dest: '3.00', other: '0.00', net: '65.00' })
    expect(b.withholdingEur.toFixed(2)).toBe('15.00')
  })

  it('las retenciones separadas mandan sobre la retención total antigua', () => {
    const b = incomeBreakdown(div({ amount: '10', withholding: '9', withholdingOrigin: '1', withholdingDest: '0.5' }))
    expect(b.withholdingEur.toFixed(2)).toBe('1.50')
    expect(b.netEur.toFixed(2)).toBe('8.50')
  })

  it('las comisiones restan del neto', () => {
    const b = incomeBreakdown(div({ amount: '10', withholdingDest: '1.9', fees: '0.1' }))
    expect(b.netEur.toFixed(2)).toBe('8.00')
  })

  it('con el neto real y sin retenciones, la retención es lo que falta hasta el bruto', () => {
    // Bruto 100 $ = 80 €; ingresaron 66,50 € → retenido 13,50 €.
    const b = incomeBreakdown(div({ amount: '100', currency: 'USD', fxRate: '1.25', netEur: '66.5' }))
    expect(eurs(b)).toEqual({ gross: '80.00', origin: '0.00', dest: '0.00', other: '13.50', net: '66.50' })
  })

  it('con el neto real y retenciones que no cuadran, manda el neto y se avisa de la diferencia', () => {
    const b = incomeBreakdown(div({ amount: '100', withholdingOrigin: '15', netEur: '84' }))
    expect(b.netEur.toFixed(2)).toBe('84.00')
    expect(b.mismatchEur?.toFixed(2)).toBe('-1.00')
  })

  it('el cambio efectivo sale del neto que el bróker ingresó (dividendo real de Nvidia)', () => {
    // 7,50 $ brutos; retención de 1,13 $ en origen y de 1,07 € en España; ingresaron 4,55 €.
    // cambio = (7,50 − 1,13) ÷ (4,55 + 1,07) = 6,37 ÷ 5,62 = 1,133452
    const fx = impliedIncomeFx({
      amount: new Decimal('7.5'), fees: new Decimal(0), currency: 'USD', netEur: new Decimal('4.55'),
      withholdings: [{ amount: new Decimal('1.13'), currency: 'USD' }, { amount: new Decimal('1.07'), currency: 'EUR' }],
    })!
    expect(fx.toString()).toBe('1.133452')
    // Con ese cambio todo cuadra con el ingreso: neto 4,55 € sin diferencias.
    const b = incomeBreakdown(
      div({ amount: '7.5', currency: 'USD', fxRate: fx.toString(), withholdingOrigin: '1.13', withholdingOriginCurrency: 'USD', withholdingDest: '1.07', withholdingDestCurrency: 'EUR', netEur: '4.55' }),
    )
    expect(eurs(b)).toEqual({ gross: '6.62', origin: '1.00', dest: '1.07', other: '0.00', net: '4.55' })
    expect(b.mismatchEur).toBeUndefined()
  })

  it('en euros no hay cambio que calcular, y sin solución posible no inventa uno', () => {
    expect(impliedIncomeFx({ amount: new Decimal(10), fees: new Decimal(0), currency: 'EUR', netEur: new Decimal(8), withholdings: [] })).toBeUndefined()
    // La retención en dólares se come todo el bruto: no hay cambio posible.
    expect(
      impliedIncomeFx({ amount: new Decimal(5), fees: new Decimal(0), currency: 'USD', netEur: new Decimal(1), withholdings: [{ amount: new Decimal(5), currency: 'USD' }] }),
    ).toBeUndefined()
  })
})
