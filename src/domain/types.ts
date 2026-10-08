/**
 * Modelo de datos de Buho.
 *
 * Reglas:
 * - Los importes y cantidades se guardan como texto ("123.45") y se operan con
 *   decimal.js. Nunca con `number`, para no arrastrar errores de coma flotante.
 * - Nada se borra físicamente: `deleted: true` marca el registro como eliminado,
 *   así la eliminación también viaja a los otros dispositivos al sincronizar.
 * - `updatedAt` (ISO 8601) decide qué versión gana al fusionar dos copias.
 */

export type ISODate = string // AAAA-MM-DD
export type ISODateTime = string
export type DecimalString = string

export interface SyncedRecord {
  id: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
  deleted?: boolean
}

export const ASSET_TYPES = {
  accion: 'Acción',
  etf: 'ETF',
  fondo: 'Fondo',
  bono: 'Bono',
  materia_prima: 'Materia prima',
  cripto: 'Cripto',
  otro: 'Otro',
} as const

export type AssetType = keyof typeof ASSET_TYPES

export interface Asset extends SyncedRecord {
  name: string
  type: AssetType
  /** Divisa en la que cotiza (ISO 4217): EUR, USD, GBP… */
  currency: string
  ticker?: string
  isin?: string
  market?: string
  note?: string
}

export const MOVEMENT_TYPES = {
  compra: 'Compra',
  venta: 'Venta',
  dividendo: 'Dividendo',
  cupon: 'Cupón',
} as const

export type MovementType = keyof typeof MOVEMENT_TYPES

export const isTrade = (t: MovementType) => t === 'compra' || t === 'venta'

export interface Movement extends SyncedRecord {
  assetId: string
  type: MovementType
  date: ISODate
  /** Compra/venta: títulos o participaciones. */
  quantity?: DecimalString
  /** Compra/venta: precio unitario en la divisa del movimiento. */
  price?: DecimalString
  /** Dividendo/cupón: importe bruto cobrado, en la divisa del movimiento. */
  amount?: DecimalString
  currency: string
  /**
   * Unidades de `currency` por 1 EUR en la fecha del movimiento
   * (como publica el BCE: 1,0850 USD = 1 EUR). Vale "1" si la divisa es EUR.
   */
  fxRate: DecimalString
  /** Comisiones y gastos, en la divisa del movimiento. */
  fees: DecimalString
  /** Retención en origen y/o destino, en la divisa del movimiento. */
  withholding: DecimalString
  account?: string
  note?: string
}

/** Formato del archivo que se guarda en Drive y en las copias exportadas. */
export interface Snapshot {
  app: 'buho'
  version: 1
  exportedAt: ISODateTime
  assets: Asset[]
  movements: Movement[]
}
