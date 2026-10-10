import type { Asset, AssetType, Quote, QuoteDay } from '../domain/types'

/** Un valor encontrado al buscar por nombre o ticker. */
export interface SearchHit {
  symbol: string
  name: string
  type: AssetType
  /** Divisa estimada; el proveedor no la da. Se puede corregir al editar el activo. */
  currency: string
  /** Bolsa o mercado, si el proveedor lo dice (p. ej. «Madrid»). */
  exchange?: string
}

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
  /** Busca valores por nombre o ticker. Los proveedores sin búsqueda no lo definen. */
  search?(query: string): Promise<SearchHit[]>
  /** Cierres diarios del activo en el periodo. Solo algunos proveedores lo dan. */
  history?(asset: Asset, range: HistoryRange): Promise<QuoteDay[]>
}

export type Fetcher = typeof fetch

export type HistoryRange = '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'max'
