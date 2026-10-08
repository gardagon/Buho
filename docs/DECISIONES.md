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

**A comprobar al implementar:** cobertura de BME y Xetra; límites actuales de cada plan; si permiten llamadas desde el navegador (CORS).

**Bonos:** pocas fuentes gratuitas. Precio manual o seguimiento a través de un ETF de renta fija. Materias primas: vía ETC o futuros.

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
