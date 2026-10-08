# Arquitectura

## Visión general

Buho es una aplicación web estática (PWA) que se ejecuta entera en el navegador del usuario. No hay backend.

```
┌──────────────── Dispositivo del usuario ────────────────┐
│                                                          │
│   UI (React)  ──►  data/repo.ts  ──►  IndexedDB (Dexie)  │
│      ▲                                     │             │
│      │            domain/portfolio.ts ◄────┘             │
│      │            (cálculos puros)                       │
│      │                                                   │
│   sync/  ──── Google Identity Services (token, 1 h) ─────┼──► Google Drive
│                                                          │     buho-cartera.json
│   quotes/ ── clave API del usuario ──────────────────────┼──► Finnhub, Frankfurter (BCE)
└──────────────────────────────────────────────────────────┘
        ▲
        │  HTML, JS, CSS, iconos (estáticos)
   GitHub Pages  ◄── GitHub Actions ◄── este repositorio
```

## Dónde vive cada cosa

| Qué | Dónde | Notas |
| --- | --- | --- |
| Código | Este repositorio → GitHub Pages | Público, sin secretos |
| Activos y movimientos | IndexedDB del navegador (BD `buho`) | Copia de trabajo; la app funciona sin conexión |
| Ajustes (ID de cliente, id del archivo de Drive, última sincronización) | Tabla `meta` de IndexedDB | Por dispositivo |
| Copia y sincronización | `buho-cartera.json` en el Drive del usuario | Opcional |
| Token de Google | Solo en memoria | Caduca en ~1 h; no se persiste |
| Cotizaciones y tipos de cambio | Se piden al abrir la app (si hace más de 15 min) y con el botón «Actualizar precios». Caché en la tabla `quotes` y en `meta` | No se guardan en Drive |
| Clave de Finnhub | Tabla `meta` | Por dispositivo; no viaja a Drive |
| Precio manual y «seguir» | Campos opcionales del `Asset` | Sí viajan en el Snapshot (siguen siendo versión 1) |

## Estructura de carpetas

```
src/
  domain/          TypeScript puro, sin React ni Dexie
    types.ts         Modelo: Asset, Movement, Snapshot
    numbers.ts       decimal.js, parseo de números escritos en español, formato es-ES
    portfolio.ts     FIFO, posiciones a coste, ventas realizadas, rendimientos, resumen anual
    valuation.ts     Valor de mercado y plusvalía latente a partir de las posiciones (puro)
    *.test.ts
  data/
    db.ts            Esquema Dexie (assets, movements, meta; quotes desde la versión 2)
    repo.ts          Altas, cambios y bajas lógicas; exportar e importar; aviso de cambios
    merge.ts         Fusión de copias por id + updatedAt; validación de Snapshot
  sync/
    google.ts        Carga de GIS, token, llamadas REST a Drive v3
    sync.ts          Algoritmo de sincronización (descargar → fusionar → subir)
    SyncContext.tsx  Estado de sincronización para React; autosync 3 s tras cada cambio
  quotes/
    types.ts         PriceProvider, QuoteResult
    finnhub.ts       Proveedor Finnhub (REST)
    fx.ts            Tipos de cambio del BCE vía Frankfurter
    service.ts       refreshQuotes: pide cotizaciones y cambios y los guarda
    QuotesContext.tsx  Estado para React; actualiza al abrir la app
  ui/
    screens/         Seguimiento (inicio), Cartera (activa e histórico), Movimientos, Activos, Ajustes
    AssetForm.tsx, MovementForm.tsx, Sheet.tsx, Toast.tsx, hooks.ts, icons.tsx
  App.tsx            Navegación por hash (#/cartera…), hojas modales, aviso de actualización
  main.tsx
  styles.css         Variables de diseño (claro/oscuro) y estilos
public/              logo.png (fuente de los iconos; se regeneran con `npx pwa-assets-generator`) e iconos PNG generados
```

## Modelo de datos

Ver `src/domain/types.ts`. Puntos clave:

- Todos los registros heredan de `SyncedRecord`: `id` (UUID), `createdAt`, `updatedAt`, `deleted?`.
- `Asset`: nombre, tipo, divisa de cotización, ticker, ISIN, mercado.
- `Movement`: `compra` y `venta` usan `quantity` y `price`; `dividendo` y `cupon` usan `amount` (bruto) y `withholding`. Todos llevan `currency`, `fxRate`, `fees`, y opcionalmente `account` y `note`.
- `fxRate` = unidades de la divisa por 1 EUR en la fecha del movimiento (convención del BCE). Importe en EUR = importe / fxRate.
- `Snapshot` (versión 1) es el formato del archivo de Drive y de las copias descargadas.

## Pantallas

- **Seguimiento** es la pantalla de inicio: solo los valores que la persona ha elegido seguir (`Asset.watched`), tengan o no movimientos.
- **Cartera** sale solo de los movimientos. Vista *Activa*: posiciones abiertas con su valor de mercado. Vista *Histórico*: resultados por año, ventas y dividendos o cupones.

## Cálculo de cartera

`computePortfolio(assets, movements)` es una función pura:

1. Descarta registros con `deleted`.
2. Ordena por fecha; en el mismo día, compras antes que ventas; después por `createdAt`.
3. Por activo mantiene una cola de lotes. Compra → nuevo lote con coste unitario en EUR y en divisa (comisiones incluidas). Venta → consume lotes FIFO y genera una `RealizedSale`.
4. Dividendos y cupones generan `IncomeEntry` (bruto, retención, neto en EUR).
5. Devuelve posiciones vivas, ventas, rendimientos e `issues` (ventas sin títulos suficientes, activos inexistentes).

La UI lo recalcula en cada cambio con `useMemo` (`ui/hooks.ts`). Para carteras personales es instantáneo; si algún día pesa, se puede cachear por activo.

## Sincronización con Drive

- Permiso `https://www.googleapis.com/auth/drive.file`: la app solo ve archivos que ha creado ella.
- Un único archivo `buho-cartera.json`. Su id se guarda en `meta.driveFileId`; si desaparece, se busca por nombre y, si no existe, se crea.
- Algoritmo (`sync/sync.ts`): descargar → `mergeSnapshots` (gana el `updatedAt` mayor por registro; empate → local) → guardar en local → subir el resultado.
- Se sincroniza al conectar, al pulsar la píldora de estado y 3 s después de cada cambio local si hay token válido.
- Al abrir la app no hay token (no se guarda): la píldora muestra «Sincronizar» y un toque reconecta. Los navegadores bloquean la ventana de Google si no la abre un gesto del usuario.

**Limitación conocida:** si dos dispositivos editan el mismo registro sin sincronizar entre medias, gana la edición más reciente de ese registro. Los registros nuevos nunca se pierden.

## PWA

- `vite-plugin-pwa` en modo `generateSW` con `registerType: 'prompt'`: cuando hay versión nueva aparece «Hay una versión nueva de Buho» con botón «Actualizar».
- `base: './'`: rutas relativas, funciona en cualquier subcarpeta.
- `navigator.storage.persist()` al arrancar para que el navegador no borre IndexedDB.

## Cotizaciones y valoración

```ts
interface PriceProvider {
  id: string
  name: string
  supports(asset: Asset): boolean
  getQuotes(assets: Asset[]): Promise<{ quotes: Map<string, Quote>; errors: Map<string, string> }>
}
```

- Un proveedor por archivo en `src/quotes/`. Hoy solo Finnhub (REST). El ticker se envía tal cual lo escribió el usuario; la divisa de la cotización es la del activo.
- `refreshQuotes` (`quotes/service.ts`) pide los activos en cartera o marcados con `watched`, guarda cada `Quote` en la tabla `quotes` y los tipos de cambio en `meta`. Un fallo en un activo no frena a los demás; los motivos se muestran en Ajustes.
- Los tipos de cambio (`FxRates`) son unidades de divisa por 1 EUR, como `Movement.fxRate`. Se piden a Frankfurter (BCE, sin clave).
- `valuePositions` (`domain/valuation.ts`) valora las posiciones de `computePortfolio` sin tocar el FIFO: precio × cantidad ÷ cambio actual. El total solo suma las posiciones que se pueden valorar y compara contra el coste de esas mismas.
- Precio: gana la cotización, salvo que el precio manual sea de un día posterior (`pickPrice`).
- La clave de Finnhub vive en `meta` y **no** se sincroniza a Drive.
- El plan gratuito de Finnhub solo cubre EE. UU.; para BME, Xetra, fondos y bonos se usa el precio manual (ver DECISIONES.md).
- Si un proveedor bloquea llamadas desde el navegador (CORS), la salida prevista es un Cloudflare Worker gratuito como proxy, nunca un servidor de pago.
