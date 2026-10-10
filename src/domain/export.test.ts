import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { yearWorkbook } from './export'
import { computePortfolio } from './portfolio'
import { yearReport, yearsWithActivity } from './sales'
import type { Asset, Movement } from './types'
import { buildXlsx, crc32, excelDate, sheetName } from './xlsx'

const now = '2026-01-01T00:00:00.000Z'
const asset: Asset = { id: 'A', name: 'Iberdrola', type: 'accion', currency: 'EUR', ticker: 'IBE.MC', isin: 'ES0144580Y14', createdAt: now, updatedAt: now }
let seq = 0
const mv = (p: Partial<Movement> & Pick<Movement, 'type' | 'date'>): Movement => ({
  id: `m${++seq}`, assetId: 'A', currency: 'EUR', fxRate: '1', fees: '0', withholding: '0',
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), updatedAt: now, ...p,
})

// Compra A: 10 × 10 € = 100 € · Compra B: 10 × 12 € = 120 €
// Venta de 15 × 20 € con 3 € de comisión (300 € brutos, 297 € netos) · dividendo de 10 € con 1,90 € de retención
const movements = [
  mv({ type: 'compra', date: '2025-01-10', quantity: '10', price: '10', account: 'MyInvestor' }),
  mv({ type: 'compra', date: '2026-02-10', quantity: '10', price: '12' }),
  mv({ type: 'venta', date: '2026-06-01', quantity: '15', price: '20', fees: '3', account: 'MyInvestor' }),
  mv({ type: 'dividendo', date: '2026-07-01', amount: '10', withholding: '1.9' }),
]
const portfolio = computePortfolio([asset], movements)

describe('yearReport', () => {
  const r = yearReport(portfolio, movements, '2026')

  it('reparte la venta entre las compras de las que sale, con su importe y comisiones', () => {
    // 15 títulos: 10 de la compra A (2/3 de 300 € = 200 €, comisión 2 €) y 5 de la B (1/3: 100 €, comisión 1 €)
    const [a, b] = r.assets[0].sales[0].pieces
    expect([a.quantity.toString(), a.grossEur.toString(), a.feesEur.toString(), a.proceedsEur.toString()]).toEqual(['10', '200', '2', '198'])
    expect([a.costEur.toString(), a.profitEur.toString(), a.profitPct?.toString(), a.holdingDays]).toEqual(['100', '98', '0.98', 507])
    expect([b.quantity.toString(), b.grossEur.toString(), b.feesEur.toString(), b.proceedsEur.toString()]).toEqual(['5', '100', '1', '99'])
    expect([b.costEur.toString(), b.profitEur.toString(), b.profitPct?.toString(), b.holdingDays]).toEqual(['60', '39', '0.65', 111])
  })

  it('totales por valor y por año', () => {
    // Transmisión 297 € − coste 160 € = 137 € (85,625 %) · dividendo neto 10 − 1,90 = 8,10 €
    const v = r.assets[0]
    expect([v.proceedsEur.toString(), v.costEur.toString(), v.profitEur.toString(), v.profitPct?.toFixed(5)]).toEqual(['297', '160', '137', '0.85625'])
    expect([v.incomeGrossEur.toString(), v.withholdingEur.toString(), v.incomeNetEur.toString()]).toEqual(['10', '1.9', '8.1'])
    expect([r.netEur.toString(), r.gainsEur.toString(), r.lossesEur.toString()]).toEqual(['137', '137', '0'])
  })

  it('la venta lleva su precio y su importe bruto y neto', () => {
    const s = r.assets[0].sales[0]
    expect([s.price.toString(), s.grossEur.toString(), s.feesEur.toString(), s.proceedsEur.toString(), s.account]).toEqual(['20', '300', '3', '297', 'MyInvestor'])
  })

  it('un año sin actividad sale vacío y la lista de años va del más reciente al más antiguo', () => {
    expect(yearReport(portfolio, movements, '2024').assets).toEqual([])
    expect(yearsWithActivity(portfolio)).toEqual(['2026'])
  })
})

/** Comprueba que las etiquetas abren y cierran en orden (XML bien formado, a grandes rasgos). */
function wellFormed(xml: string): boolean {
  const stack: string[] = []
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m
    if (selfClosing) continue
    if (closing) {
      if (stack.pop() !== name) return false
    } else stack.push(name)
  }
  return stack.length === 0
}

/** Lee las entradas de un ZIP sin comprimir y comprueba sus CRC. */
function readZip(zip: Uint8Array) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const dec = new TextDecoder()
  const files: Record<string, string> = {}
  let pos = 0
  while (dv.getUint32(pos, true) === 0x04034b50) {
    const crc = dv.getUint32(pos + 14, true)
    const size = dv.getUint32(pos + 18, true)
    const nameLen = dv.getUint16(pos + 26, true)
    const name = dec.decode(zip.subarray(pos + 30, pos + 30 + nameLen))
    const data = zip.subarray(pos + 30 + nameLen, pos + 30 + nameLen + size)
    expect(crc32(data)).toBe(crc)
    files[name] = dec.decode(data)
    pos += 30 + nameLen + size
  }
  return files
}

describe('xlsx', () => {
  const sheets = yearWorkbook(yearReport(portfolio, movements, '2026'), '10/10/2026')
  const zip = buildXlsx(sheets)
  const files = readZip(zip)

  it('es un ZIP válido con las partes que Excel espera', () => {
    expect(Object.keys(files)).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml',
    ])
    for (const [name, xml] of Object.entries(files)) {
      expect(xml.startsWith('<?xml'), name).toBe(true)
      expect(wellFormed(xml), name).toBe(true)
    }
    expect(files['xl/workbook.xml']).toContain('name="Ventas (detalle)"')
  })

  it('el detalle lleva una fila por cada compra implicada, con fórmulas y valores calculados', () => {
    const detail = files['xl/worksheets/sheet2.xml']
    expect((detail.match(/<row /g) ?? []).length).toBe(1 + 2 + 1) // cabecera + 2 piezas + total
    expect(detail).toContain('<f>I2-J2</f><v>198</v>') // valor de transmisión
    expect(detail).toContain('<f>K2-O2</f><v>98</v>') // beneficio
    expect(detail).toContain('<f>SUM(P2:P3)</f><v>137</v>')
    expect(detail).toContain(`<v>${excelDate('2026-06-01')}</v>`)
  })

  it('las fechas de Excel y los nombres de hoja se calculan bien', () => {
    expect(excelDate('1900-03-01')).toBe(61) // Excel cuenta el 29-2-1900 que no existió
    expect(excelDate('2026-01-01')).toBe(46023)
    expect(sheetName('Ventas [2026]: detalle / total')).toBe('Ventas  2026   detalle   total'.slice(0, 31))
  })

  // Para validarlo con otro programa: XLSX_OUT=/ruta/archivo.xlsx npm test
  it('escribe el archivo si se pide', () => {
    if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT, zip)
  })
})
