import { useMemo, useState } from 'react'
import type { Decimal } from '../domain/numbers'
import { yearWorkbook } from '../domain/export'
import { formatMoney, formatPercent, formatQuantity, formatSignedMoney } from '../domain/numbers'
import type { Portfolio } from '../domain/portfolio'
import { yearReport, yearsWithActivity, type AssetYear, type SaleDetail, type YearReport } from '../domain/sales'
import { estimateTax, type TaxEstimate } from '../domain/tax'
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
  // La estimación de un año necesita los anteriores: sus pérdidas pendientes se compensan con las ganancias de los siguientes.
  const tax = useMemo(
    () => (openYear ? estimateTax([...years].reverse().map((y) => summaries.get(y)!), openYear) : undefined),
    [openYear, years, summaries],
  )

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
                <span className={`row-end num ${gl(s.totalEur)}`}>
                  <strong>{formatSignedMoney(s.totalEur)}</strong>
                </span>
                <span className="row-sub num">
                  {sales === 0 ? 'Sin ventas' : `Ventas ${formatSignedMoney(s.netEur)}`}
                  {!s.incomeNetEur.isZero() && ` · dividendos y cupones ${formatSignedMoney(s.incomeNetEur)}`}
                </span>
                <span className="row-sub row-end">{open ? 'Ocultar' : 'Ver detalle'}</span>
              </button>
              {open && report && <YearPanel report={report} tax={tax} />}
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

function YearPanel({ report, tax }: { report: YearReport; tax?: TaxEstimate }) {
  const [openAssets, setOpenAssets] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setOpenAssets((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  function download() {
    downloadFile(`buho-ventas-${report.year}.xlsx`, buildXlsx(yearWorkbook(report, today(), tax)), XLSX_TYPE)
  }

  const hasSales = report.assets.some((a) => a.sales.length > 0)
  const hasDividends = !report.dividends.grossEur.isZero()
  const hasCoupons = !report.coupons.grossEur.isZero()

  return (
    <div className="year-panel">
      <div className="total-line num">
        <span>Resultado de {report.year}: ventas + dividendos y cupones netos</span>
        <strong className={gl(report.totalEur)}>{formatSignedMoney(report.totalEur)}</strong>
      </div>

      {hasSales && (
        <>
          <h3 className="list-title">Ventas</h3>
          <dl className="kv num">
            <div>
              <dt>Plusvalías</dt>
              <dd className="gain">{formatMoney(report.gainsEur)}</dd>
            </div>
            <div>
              <dt>Minusvalías</dt>
              <dd className={report.lossesEur.isZero() ? undefined : 'loss'}>{formatMoney(report.lossesEur.abs())}</dd>
            </div>
            <div>
              <dt>Neto de ventas</dt>
              <dd className={gl(report.netEur)}>{formatSignedMoney(report.netEur)}</dd>
            </div>
            <div>
              <dt>Valor de transmisión</dt>
              <dd>{formatMoney(report.proceedsEur)}</dd>
            </div>
            <div>
              <dt>Coste de adquisición</dt>
              <dd>{formatMoney(report.costEur)}</dd>
            </div>
          </dl>
        </>
      )}

      {hasDividends && <IncomeBlock title="Dividendos" t={report.dividends} />}
      {hasCoupons && <IncomeBlock title="Cupones" t={report.coupons} />}

      {tax && <TaxBlock tax={tax} />}

      <div className="actions">
        <button className="btn small" onClick={download}>
          Descargar {report.year} en Excel
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        El Excel trae el resumen, cada venta con sus compras (con fórmulas, para que puedas comprobarlo), los dividendos y la
        estimación para Hacienda.
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
                <span className={`row-end num ${gl(a.totalEur)}`}>
                  <strong>{formatSignedMoney(a.totalEur)}</strong>
                </span>
                <span className="row-sub num">
                  {a.sales.length > 0 && (
                    <>
                      Ventas {formatSignedMoney(a.profitEur)}
                      {a.profitPct && ` (${formatPercent(a.profitPct)})`}
                    </>
                  )}
                  {a.sales.length > 0 && a.incomes.length > 0 && ' · '}
                  {a.incomes.length > 0 && <>Dividendos y cupones {formatSignedMoney(a.incomeNetEur)}</>}
                </span>
                <span className="row-sub row-end">{open ? 'Ocultar' : 'Ver detalle'}</span>
              </button>
              {open && <AssetDetail a={a} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Bruto, retención y neto de dividendos o de cupones. */
function IncomeBlock({ title, t }: { title: string; t: { grossEur: Decimal; withholdingEur: Decimal; netEur: Decimal } }) {
  return (
    <>
      <h3 className="list-title">{title}</h3>
      <dl className="kv num">
        <div>
          <dt>Bruto</dt>
          <dd>{formatMoney(t.grossEur)}</dd>
        </div>
        <div>
          <dt>Retención</dt>
          <dd>{formatMoney(t.withholdingEur)}</dd>
        </div>
        <div>
          <dt>Neto cobrado</dt>
          <dd className="gain">{formatSignedMoney(t.netEur)}</dd>
        </div>
      </dl>
    </>
  )
}

const pct = (rate: number) => `${(rate * 100).toFixed(0)} %`

/** Estimación de lo que se pagaría a Hacienda por la base del ahorro, con el cálculo a la vista. */
function TaxBlock({ tax }: { tax: TaxEstimate }) {
  const toPay = tax.resultEur.gte(0)
  return (
    <section className="tax-block">
      <h3 className="list-title">Hacienda (estimación orientativa)</h3>
      <dl className="kv num">
        <div>
          <dt>Base imponible del ahorro</dt>
          <dd>{formatMoney(tax.baseEur)}</dd>
        </div>
        <div>
          <dt>Cuota estimada</dt>
          <dd>
            {formatMoney(tax.cuotaEur)}
            {tax.effectiveRate && <span className="muted"> ({formatPercent(tax.effectiveRate).replace('+', '')})</span>}
          </dd>
        </div>
        <div>
          <dt>Retenciones ya pagadas</dt>
          <dd>{formatMoney(tax.withholdingEur)}</dd>
        </div>
        <div>
          <dt>{toPay ? 'A pagar (aprox.)' : 'A devolver (aprox.)'}</dt>
          <dd className={toPay ? (tax.resultEur.isZero() ? undefined : 'loss') : 'gain'}>{formatMoney(tax.resultEur.abs())}</dd>
        </div>
      </dl>
      <details>
        <summary className="small muted">Cómo se calcula</summary>
        <ul className="tax-lines num small">
          <li>
            <span>Ganancias y pérdidas por ventas</span>
            <span>{formatSignedMoney(tax.salesEur)}</span>
          </li>
          <li>
            <span>Dividendos y cupones (importe bruto)</span>
            <span>{formatMoney(tax.incomeEur)}</span>
          </li>
          {!tax.carryAgainstSalesEur.isZero() && (
            <li>
              <span>Pérdidas de años anteriores aplicadas a las ganancias</span>
              <span>−{formatMoney(tax.carryAgainstSalesEur)}</span>
            </li>
          )}
          {!tax.lossAgainstIncomeEur.isZero() && (
            <li>
              <span>Pérdidas compensadas con dividendos y cupones (máximo el 25 % de estos)</span>
              <span>−{formatMoney(tax.lossAgainstIncomeEur)}</span>
            </li>
          )}
          <li className="tax-sum">
            <span>Base imponible del ahorro</span>
            <span>{formatMoney(tax.baseEur)}</span>
          </li>
          {tax.brackets.map((b) => (
            <li key={b.from}>
              <span>
                {formatMoney(b.base)} al {pct(b.rate)}
              </span>
              <span>{formatMoney(b.tax)}</span>
            </li>
          ))}
          <li className="tax-sum">
            <span>Cuota − retenciones</span>
            <span>
              {formatMoney(tax.cuotaEur)} − {formatMoney(tax.withholdingEur)} = {formatSignedMoney(tax.resultEur)}
            </span>
          </li>
        </ul>
        {tax.pendingLosses.length > 0 && (
          <p className="small muted">
            Pérdidas que se podrán compensar en los próximos años:{' '}
            {tax.pendingLosses.map((p) => `${formatMoney(p.amount)} de ${p.year} (hasta ${p.year + 4})`).join(', ')}.
          </p>
        )}
        {tax.note && <p className="small muted">{tax.note}</p>}
      </details>
      <p className="small muted" style={{ margin: 0 }}>
        Aproximación para territorio común (no País Vasco ni Navarra). Los dividendos tributan por el bruto y sus retenciones
        se restan de la cuota. No incluye la regla de los dos meses, la deducción por doble imposición internacional ni
        derechos de suscripción, y solo cuenta lo que hay en Buho. Contrástalo con el borrador de la Agencia Tributaria.
      </p>
    </section>
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
