import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import type { YearReport } from './sales'
import { applyBrackets, estimateTax, savingsBrackets } from './tax'

const D = (v: string | number) => new Decimal(v)
/** Un año con solo lo que importa para el cálculo. */
const yr = (year: number, sales: number, income = 0, withholding = 0) =>
  ({ year: String(year), netEur: D(sales), incomeGrossEur: D(income), withholdingEur: D(withholding) }) as YearReport

describe('escala del ahorro', () => {
  it('2026: 19 % hasta 6.000, 21 % hasta 50.000, 23 % hasta 200.000 y 27 % hasta 300.000', () => {
    // 60.000 €: 6.000×19 % + 44.000×21 % + 10.000×23 % = 1.140 + 9.240 + 2.300 = 12.680
    expect(applyBrackets(D(60000), savingsBrackets(2026).brackets).tax.toString()).toBe('12680')
    // 250.000 €: 1.140 + 9.240 + 150.000×23 % (34.500) + 50.000×27 % (13.500) = 58.380
    expect(applyBrackets(D(250000), savingsBrackets(2026).brackets).tax.toString()).toBe('58380')
  })

  it('en 2021-2023 el tramo de más de 200.000 € es del 26 %, y antes de 2021 no existe', () => {
    // 250.000 €: 1.140 + 9.240 + 34.500 + 50.000×26 % (13.000) = 57.880
    expect(applyBrackets(D(250000), savingsBrackets(2022).brackets).tax.toString()).toBe('57880')
    // 60.000 € en 2020: 12.680; 250.000 € en 2020: 1.140 + 9.240 + 200.000×23 % (46.000) = 56.380
    expect(applyBrackets(D(250000), savingsBrackets(2020).brackets).tax.toString()).toBe('56380')
  })

  it('una base que no llega al primer tramo solo paga ese tipo', () => {
    expect(applyBrackets(D(4000), savingsBrackets(2026).brackets).tax.toString()).toBe('760')
    expect(applyBrackets(D(0), savingsBrackets(2026).brackets).lines).toEqual([])
  })
})

describe('estimateTax', () => {
  it('ventas y dividendos de un año: base, cuota y diferencia con las retenciones', () => {
    // Ventas +10.000 € y dividendos 1.000 € con 190 € de retención → base 11.000 €
    // Cuota: 6.000×19 % + 5.000×21 % = 1.140 + 1.050 = 2.190 € · a pagar 2.190 − 190 = 2.000 €
    const t = estimateTax([yr(2026, 10000, 1000, 190)], '2026')!
    expect([t.baseEur.toString(), t.cuotaEur.toString(), t.withholdingEur.toString(), t.resultEur.toString()]).toEqual(['11000', '2190', '190', '2000'])
    expect(t.effectiveRate?.toFixed(4)).toBe('0.1991')
  })

  it('una pérdida solo compensa hasta el 25 % de los dividendos y el resto queda pendiente', () => {
    // Pérdida de 2.000 € y dividendos de 1.000 € (retención 190 €): compensa 25 % × 1.000 = 250 €
    // Base: 1.000 − 250 = 750 € → cuota 142,50 € → a devolver 47,50 € · quedan 1.750 € para 4 años
    const t = estimateTax([yr(2026, -2000, 1000, 190)], '2026')!
    expect([t.lossAgainstIncomeEur.toString(), t.baseEur.toString(), t.cuotaEur.toString(), t.resultEur.toString()]).toEqual(['250', '750', '142.5', '-47.5'])
    expect(t.pendingLosses).toEqual([{ year: 2026, amount: D(1750) }])
  })

  it('la pérdida de un año se resta de las ganancias de los siguientes', () => {
    // 2024: −1.954,29 € sin dividendos (no puede compensarse con nada) → queda pendiente
    // 2025: +17.414,44 € − 1.954,29 € = 15.460,15 € → 6.000×19 % + 9.460,15×21 % = 1.140 + 1.986,6315
    const t = estimateTax([yr(2024, -1954.29), yr(2025, 17414.44)], '2025')!
    expect(t.carryAgainstSalesEur.toString()).toBe('1954.29')
    expect(t.baseEur.toString()).toBe('15460.15')
    expect(t.cuotaEur.toString()).toBe('3126.6315')
    expect(t.pendingLosses).toEqual([])
  })

  it('las pérdidas caducan a los 4 años', () => {
    // Pérdida de 2020: se puede usar hasta 2024. En 2025 ya no.
    expect(estimateTax([yr(2020, -1000), yr(2025, 5000)], '2025')!.baseEur.toString()).toBe('5000')
    expect(estimateTax([yr(2020, -1000), yr(2024, 5000)], '2024')!.baseEur.toString()).toBe('4000')
    // Pérdida de 2021: se puede usar en 2025 (el cuarto año siguiente)
    expect(estimateTax([yr(2021, -1000), yr(2025, 5000)], '2025')!.baseEur.toString()).toBe('4000')
  })

  it('el límite del 25 % lo comparten la pérdida del año y las arrastradas', () => {
    // 2024: −600 € pendientes. 2025: −500 € y dividendos de 1.000 € → tope 250 €.
    // Las antiguas van primero: 250 € de 2024; la de 2025 no entra. Base 1.000 − 250 = 750 €.
    const t = estimateTax([yr(2024, -600), yr(2025, -500, 1000)], '2025')!
    expect(t.lossAgainstIncomeEur.toString()).toBe('250')
    expect(t.baseEur.toString()).toBe('750')
    expect(t.pendingLosses).toEqual([{ year: 2024, amount: D(350) }, { year: 2025, amount: D(500) }])
  })

  it('con ganancias del año, las pérdidas anteriores se aplican a ellas y el resto a los dividendos', () => {
    // 2024: −2.000 € pendientes. 2025: +500 € y dividendos 1.000 €.
    // 500 € contra las ganancias, 250 € (25 %) contra los dividendos → base 0 + 750 = 750 €; quedan 1.250 €
    const t = estimateTax([yr(2024, -2000), yr(2025, 500, 1000)], '2025')!
    expect([t.carryAgainstSalesEur.toString(), t.lossAgainstIncomeEur.toString(), t.baseEur.toString()]).toEqual(['500', '250', '750'])
    expect(t.pendingLosses).toEqual([{ year: 2024, amount: D(1250) }])
  })

  it('sin base no hay cuota, y las retenciones salen a devolver', () => {
    const t = estimateTax([yr(2026, 0, 0, 30)], '2026')!
    expect([t.cuotaEur.toString(), t.resultEur.toString()]).toEqual(['0', '-30'])
    expect(t.effectiveRate).toBeUndefined()
  })

  it('un año sin actividad no tiene estimación', () => {
    expect(estimateTax([yr(2025, 100)], '2026')).toBeUndefined()
  })
})
