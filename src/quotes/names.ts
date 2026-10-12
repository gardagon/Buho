/**
 * Reconocer el mismo fondo cotizando en otra bolsa. Yahoo da nombres distintos según la bolsa
 * («iShares Core MSCI World UCITS ETF USD (Acc)» en Londres, «ISHSIII-CORE MSCI WORLD U.ETF» en Xetra),
 * así que no se compara el nombre entero, sino las palabras que distinguen al fondo.
 */

/** Palabras que no distinguen un fondo de otro (gestora, tipo de producto, divisa de la clase). */
const COMMON = new Set(['ishares', 'ucits', 'etf', 'usd', 'acc', 'accumulating', 'eur', 'plc', 'fund', 'the', 'ireland', 'shares'])
/** Palabras que sí lo cambian: otra clase (distribución), cobertura, réplica sintética, filtros ESG… */
const VARIANTS = ['dist', 'distributing', 'hedged', 'hedge', 'swap', 'inc', 'income', 'sri', 'esg', 'screened', 'leveraged']

const words = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
const compact = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Las palabras que distinguen a este fondo: «Core», «MSCI», «World»; «Core», «S&P», «500». */
export function distinctiveWords(name: string): string[] {
  return words(name).filter((w) => !COMMON.has(w) && !w.startsWith('ishs') && w.length >= 2 && !VARIANTS.includes(w))
}

/** ¿Es `candidate` el mismo fondo que `reference` (cotizando en otra bolsa)? */
export function sameFund(reference: string, candidate: string): boolean {
  const need = distinctiveWords(reference)
  if (need.length === 0) return false
  const text = compact(candidate)
  if (!need.every((w) => text.includes(w.replace(/[^a-z0-9]/g, '')))) return false
  const refWords = new Set(words(reference))
  const candWords = new Set(words(candidate))
  // Otra clase o variante (distribución, cobertura, ESG…) no es el mismo fondo.
  return !VARIANTS.some((v) => candWords.has(v) && !refWords.has(v))
}

/** Búsquedas para encontrar las demás bolsas: el nombre completo y el nombre sin «UCITS ETF USD (Acc)». */
export function searchQueries(name: string): string[] {
  const short = name.split(/ucits/i)[0].trim()
  return short && short.toLowerCase() !== name.toLowerCase() ? [name, short] : [name]
}
