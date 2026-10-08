import Decimal from 'decimal.js'

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN })

export { Decimal }

/**
 * Convierte lo que escribe una persona en España en un decimal normalizado.
 * Acepta "1.234,56", "1234,56", "1234.56" y "1 234,56".
 * Devuelve `null` si no es un número válido.
 */
export function parseUserNumber(raw: string): string | null {
  let s = raw.trim().replace(/[\s  ]/g, '')
  if (s === '') return null
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // El último separador que aparece es el decimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (hasComma) {
    if ((s.match(/,/g) ?? []).length > 1) return null
    s = s.replace(',', '.')
  } else if (hasDot && /^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    // "1.234.567" → separadores de miles
    s = s.replace(/\./g, '')
  }
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null
  try {
    return new Decimal(s).toString()
  } catch {
    return null
  }
}

export const d = (v: string | number | Decimal | undefined | null) => new Decimal(v ?? 0)

const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
const fmtCache = new Map<string, Intl.NumberFormat>()

export function formatMoney(v: Decimal | string, currency = 'EUR'): string {
  const n = Number(d(v).toFixed(2))
  if (currency === 'EUR') return eurFmt.format(n)
  let f = fmtCache.get(currency)
  if (!f) {
    try {
      f = new Intl.NumberFormat('es-ES', { style: 'currency', currency })
    } catch {
      f = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    fmtCache.set(currency, f)
  }
  return f.format(n)
}

export function formatSignedMoney(v: Decimal | string, currency = 'EUR'): string {
  const x = d(v)
  const s = formatMoney(x.abs(), currency)
  if (x.isZero()) return s
  return (x.isNeg() ? '−' : '+') + s
}

export function formatQuantity(v: Decimal | string): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6 }).format(Number(d(v).toFixed(6)))
}

export function formatPercent(v: Decimal): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  }).format(Number(v.toFixed(6)))
}

/** Muestra un decimal guardado para editarlo en un campo: "1234.5" → "1234,5". */
export function toInputValue(v: string | undefined): string {
  return v ? v.replace('.', ',') : ''
}
