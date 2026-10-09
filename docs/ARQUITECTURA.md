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
│        └── proxy propio (Cloudflare Worker) ─────────────┼──► Yahoo Finance
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
    trade.ts         Completa una compra o venta: de total, precio, comisiones y cambio despeja el que falte
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
    yahoo.ts         Proveedor Yahoo a través del proxy propio (formato propio y estable)
    fx.ts            Tipos de cambio del BCE vía Frankfurter
    service.ts       refreshQuotes, searchSecurities (búsqueda con cotización) y followSecurity
    QuotesContext.tsx  Estado para React; actualiza al abrir la app
  ui/
    screens/         Seguimiento (inicio), Cartera (activa e histórico), Movimientos, Activos, Ajustes
    AssetForm.tsx, MovementForm.tsx, Sheet.tsx, Toast.tsx, hooks.ts, icons.tsx
  App.tsx            Navegación por hash (#/cartera…), hojas modales, aviso de actualización
  main.tsx
  styles.css         Variables de diseño (claro/oscuro) y estilos
worker/              yahoo-proxy.js: proxy de Yahoo para Cloudflare Workers (+ su test)
public/              logo.png (fuente de los iconos; se regeneran con `npx pwa-assets-generator`) e iconos PNG generados
```

## Modelo de datos

Ver `src/domain/types.ts`. Puntos clave:

- Todos los registros heredan de `SyncedRecord`: `id` (UUID), `createdAt`, `updatedAt`, `deleted?`.
- `Asset`: nombre, tipo, divisa de cotización, ticker, ISIN, mercado. `manualPrice`, `manualPriceDate` y `manualPriceCurrency` guardan el último precio manual (puede estar en otra divisa que la del activo).
- `PricePoint` (`Snapshot.prices`, opcional): cada precio manual con su fecha, divisa y el cambio del BCE de ese día. Forman el histórico y se sincronizan con Drive; el último deja `Asset.manualPrice` al día (`addPricePoint`, `deletePricePoint`). Las cotizaciones de mercado guardan además su cierre diario en `quoteDays` (solo local) para dibujar el gráfico.
- `Movement`: `compra` y `venta` usan `quantity` y `price` (en la divisa elegida: dólares o euros) y, opcionalmente, `totalEur` con el importe real cobrado o ingresado; `dividendo` y `cupon` usan `amount` (bruto) y `withholding`. Todos llevan `currency`, `fxRate`, `fees`, y opcionalmente `account` y `note`.
- `fxRate` = unidades de la divisa por 1 EUR en la fecha del movimiento (convención del BCE). Importe en EUR = importe / fxRate.
- `Snapshot` (versión 1) es el formato del archivo de Drive y de las copias descargadas.

## Pantallas

- **Seguimiento** es la pantalla de inicio: solo los valores que la persona ha elegido seguir (`Asset.watched`), tengan o no movimientos.
- **Cartera** sale solo de los movimientos. Vista *Activa*: posiciones abiertas con su valor de mercado. Vista *Histórico*: resultados por año, ventas y dividendos o cupones.

## Pantallas y precios

- **Seguimiento → ficha del valor** (`ui/PriceDetail.tsx`): precio actual en dos monedas (en la que se ve y su equivalente en euros o dólares con el cambio actual del BCE, `counterPrice`), gráfico en euros (`ui/PriceChart.tsx`, serie `priceHistory`) y lista de los precios puestos a mano, con alta y borrado.
- **Seguimiento:** cada fila enseña el precio en la **moneda principal** elegida en Ajustes (euros o dólares), con el % del día entre paréntesis en verde o rojo; debajo, más pequeño, el equivalente en la otra moneda, y a la izquierda el ticker con la fecha y hora de la cotización (o la fecha y «(manual)» si el precio lo puso la persona). La Cartera y los cálculos fiscales siempre van en euros.
- El botón «Añadir movimiento» solo existe en la pestaña Movimientos.
- **Deslizar a los lados** cambia de pestaña en el orden de la barra (Seguimiento, Cartera, Movimientos, Activos, Ajustes): `ui/useSwipeNav.ts`. Solo con el dedo; no actúa con una ventana abierta, sobre campos de texto ni sobre tablas que se desplazan, y pide un gesto claramente horizontal.
- **Ficha de una posición** (`ui/PositionDetail.tsx`, se abre al tocar un valor de la Cartera): acciones, precio medio, invertido, valor y beneficio ahora; y cómo ha ido a 1 semana, 1 mes, 1 año, 2 y 5 años (`domain/performance.ts`). Cada periodo tiene en cuenta los títulos que había en cartera en esa fecha y lo comprado, vendido y cobrado desde entonces: beneficio = valor ahora − valor entonces − compras + ventas + dividendos; el % es sobre el dinero de partida más lo comprado. El precio de cada fecha es el último conocido (manual, cotización guardada o el de tus propias compras y ventas); si es de más de 3 días antes, se indica cuál.
- **Detalle por compra** (`domain/lots.ts`): cada compra con las ventas que han salido de ella por FIFO, por separado, con fecha, títulos, precio, importe y beneficio en € y %. Si una venta sale de varias compras, su importe neto y sus comisiones se reparten por títulos.
- La divisa de cotización de un activo se elige en una lista (EUR, USD, GBP…, u «Otra…» para escribir el código). Es la moneda real en la que cotiza; la moneda en la que se ve un precio puesto a mano es independiente.
- Si hay activos o precios en una divisa sin cambio guardado, `QuotesProvider` pide los cambios al BCE sin esperar (`missingRates`); así un precio en dólares siempre se puede valorar en euros.
- Cada tipo de movimiento tiene su color (`data-tone` en la hoja): compra en verde, venta en rojo, dividendo en azul y cupón en morado.
- En los movimientos, el tipo de cambio sale por defecto del BCE del día de la operación (`fetchRateOn`); se puede escribir el del bróker.

## Compras y ventas

En el formulario, las comisiones y el total (pagado o recibido) van en **EUR**, que es lo que cobra el bróker; el precio va en la divisa que se vea en el bróker. Lo que se deja vacío se calcula y se muestra en gris (`completeTrade`). Se guarda `totalEur` solo si la persona lo escribió. Las comisiones se guardan en la divisa del movimiento (como siempre) y el coste medio por título en EUR sale de `totalEur ÷ cantidad`.

Si un mismo activo tiene compras con el precio en divisas distintas, `Position.costCurrency` pasa a EUR para no mezclar divisas en el coste medio.

## Guardado desde los formularios

Al guardar o eliminar, `Sheet` entra en estado `busy`: el botón muestra un círculo de carga y «Guardando…», el contenido se bloquea (`inert`) y no se puede cerrar (ni con «Cerrar», Escape o pulsando fuera) hasta que IndexedDB confirma la escritura. Si tarda más de 3 s se avisa de la causa más habitual: Buho abierto a la vez en otra pestaña o en la app instalada, que se esperan entre sí para escribir. Si el guardado falla, el formulario se desbloquea y se conserva lo escrito.

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

- Un proveedor por archivo en `src/quotes/`. Hoy Finnhub (REST) y Yahoo (vía proxy propio, ver `docs/YAHOO.md`). `refreshQuotes` pide primero a Finnhub; lo que este no puede cotizar pasa a Yahoo si está configurado. Yahoo da la divisa real de cada valor y se normalizan los peniques de Londres (GBp → GBP). El ticker se envía tal cual lo escribió el usuario; la divisa de la cotización es la del activo.
- «Seguir un valor» (`ui/FollowSheet.tsx`) busca por nombre o ticker con `/search` de Finnhub, muestra la cotización de cada resultado y, al elegir uno, crea el activo con `watched` (o reutiliza el que ya tenga ese ticker). Necesita la clave; sin ella ofrece seguir un activo existente o añadirlo a mano. La divisa se estima por el sufijo de bolsa y se puede corregir en el activo.
- `refreshQuotes` (`quotes/service.ts`) pide los activos en cartera o marcados con `watched`, guarda cada `Quote` en la tabla `quotes` y los tipos de cambio en `meta`. Un fallo en un activo no frena a los demás; los motivos se muestran en Ajustes.
- Los tipos de cambio (`FxRates`) son unidades de divisa por 1 EUR, como `Movement.fxRate`. Se piden a Frankfurter (BCE, sin clave).
- `valuePositions` (`domain/valuation.ts`) valora las posiciones de `computePortfolio` sin tocar el FIFO: precio × cantidad ÷ cambio actual. El total solo suma las posiciones que se pueden valorar y compara contra el coste de esas mismas.
- Precio: gana la cotización, salvo que el precio manual sea de un día posterior (`pickPrice`).
- La clave de Finnhub vive en `meta` y **no** se sincroniza a Drive.
- El plan gratuito de Finnhub solo cubre EE. UU.; para BME, Xetra, fondos y bonos se usa el precio manual (ver DECISIONES.md).
- Si un proveedor bloquea llamadas desde el navegador (CORS), la salida prevista es un Cloudflare Worker gratuito como proxy, nunca un servidor de pago.
