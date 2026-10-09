import { useRef, useState } from 'react'
import { formatMoney } from '../domain/numbers'
import type { HistoryPoint } from '../domain/valuation'

const W = 320
const H = 160
const PAD = { top: 14, right: 14, bottom: 36, left: 14 }
const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
const day = (s: string) => dateFmt.format(new Date(s + 'T12:00:00'))

/**
 * Evolución del precio en EUR. Una sola serie: sin leyenda, la línea en el color
 * del texto (el ámbar es de la marca), extremos etiquetados y tooltip al pasar el
 * dedo o el ratón. La lista de debajo hace de tabla con todos los valores.
 */
export function PriceChart({ points }: { points: HistoryPoint[] }) {
  const svg = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) return null

  const t = (s: string) => new Date(s + 'T12:00:00').getTime()
  const t0 = t(points[0].date)
  const t1 = t(points[points.length - 1].date)
  const vals = points.map((p) => Number(p.eur.toFixed(6)))
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (hi === lo) {
    lo *= 0.99
    hi *= 1.01
  }
  const x = (s: string) => PAD.left + ((t(s) - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom)
  const xy = points.map((p, i) => [x(p.date), y(vals[i])] as const)
  const line = xy.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const base = H - PAD.bottom
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${base} L${xy[0][0].toFixed(1)},${base} Z`

  function near(clientX: number) {
    const r = svg.current!.getBoundingClientRect()
    const px = ((clientX - r.left) / r.width) * W
    let best = 0
    xy.forEach(([qx], i) => {
      if (Math.abs(qx - px) < Math.abs(xy[best][0] - px)) best = i
    })
    setHover(best)
  }

  const last = points.length - 1
  const hp = hover === null ? null : points[hover]
  const first = vals[0]
  const change = ((vals[last] - first) / first) * 100

  return (
    <figure className="price-chart">
      <figcaption className="small muted">
        Precio en euros · {change >= 0 ? '+' : '−'}
        {Math.abs(change).toFixed(1).replace('.', ',')} % desde el {day(points[0].date)}
      </figcaption>
      <div className="price-chart-box">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Evolución del precio entre el ${day(points[0].date)} y el ${day(points[last].date)}`}
          onPointerMove={(e) => near(e.clientX)}
          onPointerDown={(e) => near(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          {/* Eje y: mínimo y máximo, líneas finas y discretas */}
          {[hi, lo].map((v, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="chart-grid" />
              <text x={PAD.left} y={y(v) + (i === 0 ? -4 : 11)} className="chart-axis">
                {formatMoney(v.toFixed(6), 'EUR')}
              </text>
            </g>
          ))}
          <path d={area} className="chart-area" />
          <path d={line} className="chart-line" />
          <text x={PAD.left} y={H - 6} className="chart-axis">
            {day(points[0].date)}
          </text>
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="chart-axis">
            {day(points[last].date)}
          </text>
          {hover !== null && <line x1={xy[hover][0]} x2={xy[hover][0]} y1={PAD.top} y2={base} className="chart-cross" />}
          {/* Marcador del último valor (o del punto señalado), con anillo del color de la superficie */}
          <circle cx={xy[hover ?? last][0]} cy={xy[hover ?? last][1]} r={6} className="chart-ring" />
          <circle cx={xy[hover ?? last][0]} cy={xy[hover ?? last][1]} r={4} className="chart-dot" />
        </svg>
        {hp && (
          <div
            className="chart-tip num"
            role="status"
            style={{ left: `${Math.min(Math.max((xy[hover!][0] / W) * 100, 18), 82)}%` }}
          >
            <strong>{formatMoney(hp.eur, 'EUR')}</strong>
            <span className="muted">
              {day(hp.date)} · {hp.source === 'manual' ? 'manual' : 'mercado'}
            </span>
          </div>
        )}
      </div>
    </figure>
  )
}
