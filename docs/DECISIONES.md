# Decisiones

Registro de las decisiones tomadas y por qué. Si alguna cambia, añade una entrada nueva con la fecha en vez de borrar la anterior.

## 2026-10-08: PWA en lugar de app nativa

**Decisión:** aplicación web instalable (PWA) alojada en GitHub Pages.

**Por qué:** la prioridad es coste cero. Publicar en tiendas cuesta dinero (Apple Developer Program 99 $/año; Google Play 25 $ una vez). Además, en 2026 Google introduce la verificación de desarrolladores Android, que también afecta a los APK instalados fuera de la tienda. Una PWA se instala desde el navegador en Android, iPhone y ordenador sin pasar por tiendas.

**Consecuencias:**
- Las cotizaciones solo se actualizan con la app abierta (una PWA no se ejecuta en segundo plano).
- Si se lanza al público, se puede empaquetar para Google Play (Trusted Web Activity) pagando entonces los 25 $, sin reescribir.

## 2026-10-08: local-first, sin servidor

**Decisión:** los datos viven en IndexedDB de cada dispositivo; Google Drive es copia y puente entre dispositivos.

**Por qué:** coste cero a cualquier escala, funciona sin conexión y el desarrollador no custodia datos financieros de nadie (menos obligaciones de privacidad si se lanza).

## 2026-10-08: Google Drive con `drive.file`, archivo visible

**Decisión:** permiso `drive.file` y un archivo visible `buho-cartera.json` en el Drive del usuario.

**Alternativa descartada:** `drive.appdata` (carpeta oculta). También es un permiso no sensible, pero el usuario no ve el archivo y se borra si desinstala la app de su Drive.

**Por qué:** con datos financieros, el usuario debe poder ver, copiar y llevarse su archivo. `drive.file` es no sensible, así que la verificación de Google es gratuita (pide política de privacidad publicada).

**Pendiente:** cifrado opcional en el dispositivo antes de subir.

## 2026-10-08: proveedores de cotizaciones

**Decisión:** interfaz `PriceProvider` intercambiable; primer proveedor Finnhub. Cada usuario usa su propia clave gratuita.

| Proveedor | Plan gratuito (según comparativas de 2026) | Papel |
| --- | --- | --- |
| Finnhub | 60 llamadas/min, WebSocket incluido, tiempo real limitado | Principal |
| Twelve Data | 8 créditos/min, 800/día; multiactivo | Alternativa, multiactivo |
| Alpha Vantage | 25 peticiones/día | Histórico y macro |

**Por qué la clave del usuario:** tener una clave gratuita no da derecho a redistribuir datos. Si cada usuario pide sus propias cotizaciones, no hay problema de licencias al publicar la app, ni coste.

**A comprobar al implementar:** cobertura de BME y Xetra (comprobado, ver la entrada siguiente); límites actuales de cada plan; si permiten llamadas desde el navegador (CORS).

**Bonos:** pocas fuentes gratuitas. Precio manual o seguimiento a través de un ETF de renta fija. Materias primas: vía ETC o futuros.

## 2026-10-08: Finnhub gratuito no cubre BME ni Xetra

**Hallazgo:** al empezar la fase 4 se comprobó la cobertura. El plan gratuito de Finnhub solo da cotizaciones de valores de EE. UU.; las bolsas internacionales (BME, Xetra…) exigen plan de pago. Twelve Data tampoco da tiempo real europeo en su plan gratuito, según su propia documentación.

**Decisión:** mantener Finnhub como primer proveedor (cubre EE. UU. y es el que ya está integrado) y tratar el **precio manual** como vía normal para valores europeos, fondos y bonos. La interfaz `PriceProvider` queda lista para añadir otro proveedor sin tocar la valoración.

**Por qué no pagar ni cambiar de arquitectura:** el coste cero es una regla del proyecto. Alternativas no oficiales (scraping, endpoints sin documentar) se descartan por frágiles y de licencia dudosa.

**Pendiente:** valorar un segundo proveedor gratuito que cubra Europa si el precio manual resulta incómodo. No se ha podido probar contra las APIs reales desde el entorno de desarrollo (red bloqueada): solo hay tests con respuestas simuladas.

## 2026-10-09: Yahoo Finance con un proxy propio en Cloudflare Workers

**Decisión:** añadir Yahoo Finance como segundo proveedor de cotizaciones, a través de un Worker de Cloudflare que despliega cada persona en su cuenta gratuita (`worker/yahoo-proxy.js`, pasos en `docs/YAHOO.md`). Finnhub sigue siendo el primero; lo que no cubre pasa a Yahoo. Si hay proxy, la búsqueda de valores usa Yahoo.

**Por qué:** Finnhub gratuito no cubre BME ni Xetra (ver la entrada del 2026-10-08). Alpha Vantage y Twelve Data tampoco lo resuelven gratis y exigen clave. Yahoo cubre los mercados europeos sin registro, pero bloquea las llamadas desde navegadores, de ahí el proxy.

**Riesgos aceptados:** la API de Yahoo no es oficial y sus condiciones restringen el uso automatizado; puede cambiar o limitar. Se acepta para uso personal. Se aísla en el Worker (la app habla con un formato propio) para que un cambio de Yahoo se arregle sin publicar la app. Cumple la regla de coste cero (plan gratuito de Cloudflare) y de privacidad (solo salen tickers).

**Pendiente:** probarlo contra Yahoo real; desde el entorno de desarrollo no hay salida a la red, así que solo está probado con respuestas simuladas.

## 2026-10-08: stack

- Vite + React + TypeScript. `vite-plugin-pwa` para service worker y manifiesto.
- Dexie sobre IndexedDB; `dexie-react-hooks` para consultas reactivas.
- `decimal.js` para todo cálculo monetario.
- Vitest (+ `fake-indexeddb`) para tests.
- Sin librería de componentes ni de routing: CSS propio y navegación por hash, para que pese poco y funcione en GitHub Pages sin configurar rutas.
- Hanken Grotesk autoalojada (`@fontsource-variable`), para que funcione sin conexión.

## 2026-10-08: tipo de cambio guardado por operación

**Decisión:** cada movimiento guarda el tipo de cambio de su fecha (unidades de divisa por 1 EUR).

**Por qué:** Hacienda calcula la ganancia en euros con el cambio de cada fecha, así que el efecto divisa forma parte de la plusvalía. Un único tipo de cambio actual daría resultados fiscales falsos.
