import type { Asset, Quote } from '../domain/types'

export interface QuoteResult {
  quotes: Map<string, Quote>
  /** Por qué falló cada activo (clave: id del activo). */
  errors: Map<string, string>
}

/** Fuente de cotizaciones. Cada proveedor vive en su archivo de `src/quotes/`. */
export interface PriceProvider {
  id: string
  name: string
  /** ¿Sabe pedir este activo? Fondos y bonos no suelen tener ticker bursátil. */
  supports(asset: Asset): boolean
  getQuotes(assets: Asset[]): Promise<QuoteResult>
}

export type Fetcher = typeof fetch
