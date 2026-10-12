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
  /**
   * Precio puesto a mano, en la divisa de cotización del activo. Para lo que
   * no cotiza (fondos, bonos) o lo que el proveedor no cubre. Es opcional, así
   * que el formato del archivo de Drive (versión 1) no cambia.
   */
  manualPrice?: DecimalString
  manualPriceDate?: ISODate
  /** Divisa del precio manual (por defecto, la del activo): p. ej. un precio en $ de Investing. */
  manualPriceCurrency?: string
  /** Aparece en la pantalla de Seguimiento aunque no se tenga en cartera. */
  watched?: boolean
}

/**
 * Precio puesto a mano en una fecha. Forman el histórico de precios del activo
 * y viajan a Drive con el resto de datos. `Asset.manualPrice` guarda el más reciente.
 */
export interface PricePoint extends SyncedRecord {
  assetId: string
  date: ISODate
  price: DecimalString
  currency: string
  /** Unidades de `currency` por 1 EUR ese día (BCE), si se pudo obtener. */
  fxRate?: DecimalString
}

/** Cotización de cierre de un día, guardada para dibujar el histórico. Solo local. */
export interface QuoteDay {
  assetId: string
  date: ISODate
  /** Cierre del día (o último precio visto, si el día aún no ha cerrado). */
  price: DecimalString
  currency: string
  /** Máximo y mínimo del día, si el proveedor los da: sirven para comprobar precios de movimientos. */
  high?: DecimalString
  low?: DecimalString
}

/**
 * Última cotización conocida de un activo. Es una caché local: no viaja en el
 * Snapshot ni se sincroniza con Drive.
 */
export interface Quote {
  assetId: string
  price: DecimalString
  /** Divisa en la que viene el precio. */
  currency: string
  at: ISODateTime
  /** Cierre anterior, para calcular la variación del día. */
  prevClose?: DecimalString
  /** Proveedor que la dio (`finnhub`…). */
  provider: string
}

/** Tipos de cambio actuales: unidades de divisa por 1 EUR (convención del BCE). */
export interface FxRates {
  /** Fecha de los tipos que publica el BCE. */
  date: ISODate
  rates: Record<string, DecimalString>
}

export const MOVEMENT_TYPES = {
  compra: 'Compra',
  venta: 'Venta',
  dividendo: 'Dividendo',
  cupon: 'Cupón',
  traspaso: 'Traspaso',
} as const

export type MovementType = keyof typeof MOVEMENT_TYPES

export const isTrade = (t: MovementType) => t === 'compra' || t === 'venta'

export interface Movement extends SyncedRecord {
  assetId: string
  type: MovementType
  date: ISODate
  /** Compra/venta: títulos o participaciones. Traspaso: participaciones que salen del fondo de origen. */
  quantity?: DecimalString
  /** Traspaso entre fondos (art. 94 LIRPF): el fondo de destino y las participaciones que recibe. No tributa. */
  toAssetId?: string
  toQuantity?: DecimalString
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
  /**
   * Compra/venta: importe real que el bróker cobró (compra) o ingresó (venta),
   * en EUR, con comisiones y cambio ya incluidos. Si existe, manda sobre el
   * cálculo cantidad × precio ± comisiones ÷ cambio, que es solo una estimación
   * cuando el bróker aplica su propio cambio. Opcional: el formato sigue en la versión 1.
   */
  totalEur?: DecimalString
  /** Comisiones y gastos, en la divisa del movimiento. */
  fees: DecimalString
  /**
   * Compra/venta: impuestos inherentes a la operación (p. ej. la tasa sobre transacciones financieras), en la divisa
   * del movimiento. Opcional; si falta, es 0. Como las comisiones, suman al coste de adquisición (art. 35 LIRPF) o
   * restan del valor de transmisión. Los movimientos anteriores lo llevan todo en `fees`.
   */
  taxes?: DecimalString
  /**
   * Retención total, en la divisa del movimiento. En dividendos y cupones con las retenciones
   * separadas (abajo) vale la suma, para que las versiones anteriores sigan viendo el mismo neto.
   */
  withholding: DecimalString
  /** Dividendo/cupón: retención en el país de origen del valor, con su divisa (por defecto, la del movimiento). Opcional. */
  withholdingOrigin?: DecimalString
  withholdingOriginCurrency?: string
  /** Dividendo/cupón: retención en España (a cuenta del IRPF), con su divisa (por defecto, la del movimiento). Opcional. */
  withholdingDest?: DecimalString
  withholdingDestCurrency?: string
  /** Dividendo/cupón: lo que el bróker ingresó realmente, en EUR. Si existe, manda sobre bruto − retenciones − comisiones. Opcional. */
  netEur?: DecimalString
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
  /** Histórico de precios manuales. Opcional: las copias anteriores no lo tienen. */
  prices?: PricePoint[]
}
