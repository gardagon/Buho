import { describe, expect, it } from 'vitest'
import { incomeBreakdown } from './income'
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
})
