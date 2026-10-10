import { useMemo, useState } from 'react'
import { yearWorkbook } from '../domain/export'
import { formatMoney, formatPercent, formatQuantity, formatSignedMoney } from '../domain/numbers'
import type { Portfolio } from '../domain/portfolio'
import { yearReport, yearsWithActivity, type AssetYear, type SaleDetail, type YearReport } from '../domain/sales'
import type { Movement } from '../domain/types'
import { buildXlsx } from '../domain/xlsx'
import { downloadFile, XLSX_TYPE } from './download'

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
const day = (s: string) => dateFmt.format(new Date(s + 'T12:00:00'))
const gl = (v: { isNeg(): boolean }) => (v.isNeg() ? 'loss' : 'gain')
const today = () => new Date().toLocaleDateString('es-ES')

interface Props {
  portfolio: Portfolio
  movements: Movement[]
}

/**
 * Histórico: una fila por año. Al tocar un año se despliegan debajo sus totales y
 * los valores con actividad; al tocar un valor, cada venta con las compras de las
 * que salen los títulos.
 */
export function Historico({ portfolio, movements }: Props) {
  const years = useMemo(() => yearsWithActivity(portfolio), [portfolio])
  const [openYear, setOpenYear] = useState<string | null>(null)
  const report = useMemo(() => (openYear ? yearReport(portfolio, movements, openYear) : null), [portfolio, movements, openYear])
  const summaries = useMemo(() => new Map(years.map((y) => [y, yearReport(portfolio, movements, y)])), [portfolio, movements, years])

  if (years.length === 0) return null

  return (
    <section>
      <h2>Resultados por año</h2>
      <ul className="rows">
        {years.map((y) => {
          const s = summaries.get(y)!
          const open = openYear === y
          const sales = s.assets.reduce((n, a) => n + a.sales.length, 0)
          return (
            <li key={y}>
              <button
                className="row year-row"
                aria-expanded={open}
                onClick={() => setOpenYear(open ? null : y)}
              >
                <span className="row-title">
                  <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span> {y}
                </span>
                <span className={`row-end num ${gl(s.netEur)}`}>
                  <strong>{formatSignedMoney(s.netEur)}</strong>
                </span>
                <span className="row-sub num">
                  {sales === 0 ? 'Sin ventas' : sales === 1 ? '1 venta' : `${sales} ventas`}
                  {!s.incomeGrossEur.isZero() && ` · dividendos ${formatMoney(s.incomeGrossEur)}`}
                </span>
                <span className="row-sub row-end">{open ? 'Ocultar' : 'Ver detalle'}</span>
              </button>
              {open && report && <YearPanel report={report} />}
            </li>
          )
        })}
      </ul>
      <p className="small muted" style={{ marginTop: 8 }}>
        Orientativo. Aún no aplica la regla de los dos meses ni los traspasos entre fondos; compruébalo antes de usarlo en la declaración.
      </p>
    </section>
  )
}

function YearPanel({ report }: { report: YearReport }) {
  const [openAssets, setOpenAssets] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setOpenAssets((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  function download() {
    downloadFile(`buho-ventas-${report.year}.xlsx`, buildXlsx(yearWorkbook(report, today())), XLSX_TYPE)
  }

  return (
    <div className="year-panel">
      <dl className="kv num">
        <div>
          <dt>Plusvalías</dt>
          <dd className="gain">{formatMoney(report.gainsEur)}</dd>
        </div>
        <div>
          <dt>Minusvalías</dt>
          <dd className={report.lossesEur.isZero() ? undefined : "loss"}>{formatMoney(report.lossesEur.abs())}</dd>
        </div>
        <div>
          <dt>Neto de ventas</dt>
          <dd className={gl(report.netEur)}>{formatSignedMoney(report.netEur)}</dd>
        </div>
        <div>
          <dt>Dividendos y cupones</dt>
          <dd>{formatMoney(report.incomeGrossEur)}</dd>
        </div>
        <div>
          <dt>Valor de transmisión</dt>
          <dd>{formatMoney(report.proceedsEur)}</dd>
        </div>
        <div>
          <dt>Retenciones</dt>
          <dd>{formatMoney(report.withholdingEur)}</dd>
        </div>
      </dl>

      <div className="actions">
        <button className="btn small" onClick={download}>
          Descargar {report.year} en Excel
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        El Excel trae el resumen, cada venta con sus compras (con fórmulas, para que puedas comprobarlo) y los dividendos.
      </p>

      <h3 className="list-title">Por valor</h3>
      <ul className="rows">
        {report.assets.map((a) => {
          const open = openAssets.has(a.asset.id)
          return (
            <li key={a.asset.id}>
              <button className="row" aria-expanded={open} onClick={() => toggle(a.asset.id)}>
                <span className="row-title">
                  <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span> {a.asset.name}
                </span>
                <span className={`row-end num ${a.sales.length ? gl(a.profitEur) : ''}`}>
                  <strong>{a.sales.length ? formatSignedMoney(a.profitEur) : '—'}</strong>
                  {a.profitPct && <span> ({formatPercent(a.profitPct)})</span>}
                </span>
                <span className="row-sub num">
                  {a.sales.length > 0 && `Vendido ${formatMoney(a.proceedsEur)} · coste ${formatMoney(a.costEur)}`}
                  {a.sales.length > 0 && a.incomes.length > 0 && ' · '}
                  {a.incomes.length > 0 && `Dividendos ${formatMoney(a.incomeGrossEur)}`}
                </span>
                <span className="row-sub row-end">{open ? 'Ocultar' : 'Ver ventas'}</span>
              </button>
              {open && <AssetDetail a={a} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AssetDetail({ a }: { a: AssetYear }) {
  return (
    <div className="asset-detail">
      {a.sales.map((s) => (
        <SaleCard key={s.movementId} sale={s} />
      ))}
      {a.incomes.length > 0 && (
        <div className="sale-card income-card">
          <header className="sale-head">
            <strong>Dividendos y cupones</strong>
            <span className="num">{formatMoney(a.incomeNetEur)} netos</span>
          </header>
          {a.incomes.map((i) => (
            <p key={i.movementId} className="small muted num">
              {day(i.date)} · {i.type === 'cupon' ? 'Cupón' : 'Dividendo'}: bruto {formatMoney(i.grossEur)}, retención{' '}
              {formatMoney(i.withholdingEur)}
              {!i.feesEur.isZero() && `, comisiones ${formatMoney(i.feesEur)}`}, neto {formatMoney(i.netEur)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** Una venta con los datos de la operación y, debajo, las compras de las que salen sus títulos. */
function SaleCard({ sale: s }: { sale: SaleDetail }) {
  return (
    <article className="sale-card">
      <header className="sale-head">
        <strong>Venta del {day(s.date)}</strong>
        <span className={`num ${gl(s.profitEur)}`}>
          {formatSignedMoney(s.profitEur)}
          {s.profitPct && ` (${formatPercent(s.profitPct)})`}
        </span>
      </header>
      <p className="num">
        {formatQuantity(s.quantity)} × {formatMoney(s.price, s.currency)} = <strong>{formatMoney(s.grossEur)}</strong>
        {s.currency !== 'EUR' && <span className="muted"> (cambio {formatQuantity(s.fxRate)})</span>}
      </p>
      <p className="small muted num">
        Comisiones {formatMoney(s.feesEur)} · valor de transmisión {formatMoney(s.proceedsEur)} · coste de adquisición{' '}
        {formatMoney(s.costEur)}
        {s.account && ` · ${s.account}`}
      </p>
      {s.pieces.map((p) => (
        <div key={p.buyMovementId + p.quantity.toString()} className="piece">
          <div className="piece-title">
            Sale de la compra del {day(p.buyDate)} <span className="muted">· {p.holdingDays} días</span>
          </div>
          <div className="num">
            {formatQuantity(p.quantity)} × {formatMoney(p.buyPrice, p.buyCurrency)} · coste {formatMoney(p.costEur)}
          </div>
          <div className="num">
            Ingreso {formatMoney(p.proceedsEur)} ·{' '}
            <span className={gl(p.profitEur)}>
              beneficio {formatSignedMoney(p.profitEur)}
              {p.profitPct && ` (${formatPercent(p.profitPct)})`}
            </span>
          </div>
        </div>
      ))}
    </article>
  )
}
