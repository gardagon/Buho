import { Decimal } from './numbers'
import type { Cell, SheetData } from './xlsx'
import type { YearReport } from './sales'

const n = (x: Decimal) => Number(x.toFixed(10))
const eur = (x: Decimal, style: 'eur' | 'eurNegrita' = 'eur'): Cell => ({ v: n(x), style })
const head = (...labels: string[]): Cell[] => labels.map((v) => ({ v, style: 'cabecera' as const }))

/** Índice (0-based) de columna a letra, para escribir fórmulas. */
const col = (i: number) => String.fromCharCode(65 + i)

/**
 * El libro de Excel de un año: resumen por valor, detalle de cada venta con las
 * compras de las que salen los títulos (una fila por cada compra implicada),
 * dividendos y cupones, y notas. Las columnas de resultado son fórmulas, para
 * que se pueda comprobar a mano y cambiar un dato.
 */
export function yearWorkbook(r: YearReport, generatedOn: string): SheetData[] {
  // ---------- Ventas (detalle) ----------
  const salesHead = head(
    'Valor', 'Ticker', 'ISIN',
    'Fecha de venta', 'Títulos vendidos', 'Precio de venta por título', 'Divisa de la venta', 'Cambio (divisa por 1 €)',
    'Importe bruto de la venta (€)', 'Comisiones de la venta (€)', 'Valor de transmisión (€)',
    'Fecha de compra', 'Precio de compra por título', 'Divisa de la compra', 'Coste de adquisición con comisiones (€)',
    'Beneficio (€)', 'Beneficio (%)', 'Días en cartera', 'Cuenta',
  )
  const sales: Cell[][] = [salesHead]
  for (const a of r.assets) {
    for (const s of a.sales) {
      for (const p of s.pieces) {
        const row = sales.length + 1
        sales.push([
          a.asset.name, a.asset.ticker ?? '', a.asset.isin ?? '',
          { date: s.date }, { v: n(p.quantity), style: 'num' }, { v: n(s.price), style: 'num' }, s.currency, { v: Number(s.fxRate), style: 'num' },
          eur(p.grossEur), eur(p.feesEur),
          { f: `${col(8)}${row}-${col(9)}${row}`, v: n(p.proceedsEur), style: 'eur' },
          { date: p.buyDate }, { v: n(p.buyPrice), style: 'num' }, p.buyCurrency, eur(p.costEur),
          { f: `${col(10)}${row}-${col(14)}${row}`, v: n(p.profitEur), style: 'eur' },
          { f: `IF(${col(14)}${row}=0,"",${col(15)}${row}/${col(14)}${row})`, v: p.profitPct ? n(p.profitPct) : '', style: 'pct' },
          { f: `${col(3)}${row}-${col(11)}${row}`, v: p.holdingDays },
          s.account ?? '',
        ])
      }
    }
  }
  if (sales.length > 1) {
    const last = sales.length
    const t = last + 1
    const sumOf = (c: number, v: Decimal): Cell => ({ f: `SUM(${col(c)}2:${col(c)}${last})`, v: n(v), style: 'eurNegrita' })
    const pieces = r.assets.flatMap((a) => a.sales.flatMap((s) => s.pieces))
    const total = (f: (p: (typeof pieces)[number]) => Decimal) => pieces.reduce((x, p) => x.plus(f(p)), new Decimal(0))
    const cost = total((p) => p.costEur)
    const profit = total((p) => p.profitEur)
    sales.push([
      { v: 'Total', style: 'negrita' }, null, null, null, null, null, null, null,
      sumOf(8, total((p) => p.grossEur)), sumOf(9, total((p) => p.feesEur)), sumOf(10, total((p) => p.proceedsEur)),
      null, null, null, sumOf(14, cost), sumOf(15, profit),
      { f: `IF(${col(14)}${t}=0,"",${col(15)}${t}/${col(14)}${t})`, v: cost.gt(0) ? n(profit.div(cost)) : '', style: 'pctNegrita' },
    ])
  }

  // ---------- Resumen por valor ----------
  const summary: Cell[][] = [
    head('Valor', 'Ticker', 'ISIN', 'Ventas', 'Valor de transmisión (€)', 'Coste de adquisición (€)', 'Beneficio (€)', 'Beneficio (%)', 'Dividendos y cupones brutos (€)', 'Retenciones (€)', 'Dividendos y cupones netos (€)'),
  ]
  for (const a of r.assets) {
    const row = summary.length + 1
    summary.push([
      a.asset.name, a.asset.ticker ?? '', a.asset.isin ?? '', a.sales.length,
      eur(a.proceedsEur), eur(a.costEur),
      { f: `E${row}-F${row}`, v: n(a.profitEur), style: 'eur' },
      { f: `IF(F${row}=0,"",G${row}/F${row})`, v: a.profitPct ? n(a.profitPct) : '', style: 'pct' },
      eur(a.incomeGrossEur), eur(a.withholdingEur),
      eur(a.incomeNetEur),
    ])
  }
  if (summary.length > 1) {
    const last = summary.length
    const t = last + 1
    const sumCol = (c: string, v: Decimal): Cell => ({ f: `SUM(${c}2:${c}${last})`, v: n(v), style: 'eurNegrita' })
    summary.push([
      { v: 'Total', style: 'negrita' }, null, null,
      { f: `SUM(D2:D${last})`, v: r.assets.reduce((s, a) => s + a.sales.length, 0), style: 'negrita' },
      sumCol('E', r.proceedsEur), sumCol('F', r.costEur), sumCol('G', r.netEur),
      { f: `IF(F${t}=0,"",G${t}/F${t})`, v: r.costEur.gt(0) ? n(r.netEur.div(r.costEur)) : '', style: 'pctNegrita' },
      sumCol('I', r.incomeGrossEur), sumCol('J', r.withholdingEur), sumCol('K', r.incomeNetEur),
    ])
    summary.push([])
    summary.push([{ v: 'Ventas con beneficio', style: 'negrita' }, null, null, null, null, null, eur(r.gainsEur, 'eurNegrita')])
    summary.push([{ v: 'Ventas con pérdida', style: 'negrita' }, null, null, null, null, null, eur(r.lossesEur, 'eurNegrita')])
  }

  // ---------- Dividendos y cupones ----------
  const income: Cell[][] = [head('Valor', 'Fecha', 'Tipo', 'Bruto (€)', 'Retención (€)', 'Comisiones (€)', 'Neto (€)')]
  for (const a of r.assets) {
    for (const i of a.incomes) {
      const row = income.length + 1
      income.push([
        a.asset.name, { date: i.date }, i.type === 'cupon' ? 'Cupón' : 'Dividendo',
        eur(i.grossEur), eur(i.withholdingEur), eur(i.feesEur),
        { f: `D${row}-E${row}-F${row}`, v: n(i.netEur), style: 'eur' },
      ])
    }
  }

  const notes: Cell[][] = [
    [{ v: `Buho · Ventas y rendimientos de ${r.year}`, style: 'negrita' }],
    [{ v: `Generado el ${generatedOn}`, style: 'texto' }],
    [],
    [{ v: 'Cómo se ha calculado', style: 'negrita' }],
    [{ v: 'Criterio FIFO: en cada venta salen primero los títulos comprados antes (art. 37.2 LIRPF). Cada fila de «Ventas (detalle)» es la parte de una venta que sale de una compra concreta.', style: 'texto' }],
    [{ v: 'Coste de adquisición: lo pagado por la compra en euros, con las comisiones. Valor de transmisión: lo ingresado por la venta, ya sin comisiones. Si una venta sale de varias compras, su importe y sus comisiones se reparten por títulos.', style: 'texto' }],
    [{ v: 'Divisas: los importes en euros usan el importe real en euros si se indicó, o el cambio de la fecha de cada operación.', style: 'texto' }],
    [{ v: 'Las columnas de resultado son fórmulas: puedes cambiar un dato y ver cómo se recalcula.', style: 'texto' }],
    [],
    [{ v: 'Aviso: es orientativo. No aplica la regla de los dos meses, los traspasos entre fondos ni los derechos de suscripción. Compruébalo antes de usarlo en la declaración.', style: 'texto' }],
  ]

  return [
    { name: 'Resumen', rows: summary, widths: [34, 12, 15, 8, 18, 18, 16, 12, 20, 14, 20], freezeHeader: true },
    { name: 'Ventas (detalle)', rows: sales, widths: [34, 12, 15, 13, 12, 14, 10, 12, 16, 15, 16, 13, 14, 10, 18, 14, 12, 10, 16], freezeHeader: true },
    { name: 'Dividendos y cupones', rows: income, widths: [34, 13, 12, 14, 14, 14, 14], freezeHeader: true },
    { name: 'Notas', rows: notes, widths: [120] },
  ]
}
