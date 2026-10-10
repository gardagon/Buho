# Hoja de ruta

## Hecho (v0.1.0, 2026-10-08)

- [x] PWA instalable, funciona sin conexión, publicada en GitHub Pages
- [x] Activos: alta, edición, baja (con sus movimientos)
- [x] Movimientos: compra, venta, dividendo, cupón; comisiones, retención, tipo de cambio, cuenta y notas
- [x] Posiciones a coste con FIFO y reparto por tipo de activo
- [x] Plusvalías, minusvalías y rendimientos por año (orientativo)
- [x] Aviso de ventas sin títulos suficientes
- [x] Sincronización con Google Drive (`drive.file`)
- [x] Copias de seguridad: descargar e importar JSON (fusiona, no sobrescribe)
- [x] CI: tests y despliegue automático en cada push a `main`

## Siguiente

### Configuración de Google (lo hace el usuario)
- [ ] Crear el ID de cliente OAuth en Google Cloud (pasos en el README)
- [ ] Guardarlo como variable de repositorio `GOOGLE_CLIENT_ID`
- [ ] Probar la sincronización entre móvil y ordenador

### Fase 4: cotizaciones y valoración (hecha salvo lo marcado)
- [x] `src/quotes/` con la interfaz `PriceProvider` (ver ARQUITECTURA.md)
- [x] Proveedor Finnhub por REST
- [ ] Finnhub por WebSocket (precio en vivo con la app abierta)
- [x] Cobertura BME y Xetra comprobada: **no está en el plan gratuito** (ver DECISIONES.md)
- [x] Clave API del usuario en Ajustes
- [x] Tabla `quotes` en Dexie (versión 2 del esquema) con la última cotización
- [x] Tipos de cambio actuales (Frankfurter/BCE) para valorar en EUR
- [x] Precio manual para activos sin cotización
- [x] Cartera: valor de mercado, plusvalía latente por posición y total
- [x] Pantalla de Seguimiento con los valores seleccionados, como pantalla de inicio
- [x] Buscador de valores al seguir (Finnhub `/search`) con cotización en cada resultado
- [x] Cartera con vista activa e histórico (ventas, dividendos y resultados por año)
- [ ] Probar con una clave real de Finnhub y con Frankfurter desde el navegador (CORS); solo se ha probado con respuestas simuladas
- [ ] Segundo proveedor que cubra BME y Xetra (Twelve Data u otro) si el precio manual se queda corto

### Yahoo Finance con proxy propio (BME, Xetra y resto de Europa)
- [x] Worker de Cloudflare (`worker/yahoo-proxy.js`), proveedor `yahoo.ts`, respaldo cuando Finnhub falla, búsqueda y ajuste de la dirección
- [x] Guía de instalación (`docs/YAHOO.md`)
- [x] Histórico diario de Yahoo (ruta `/history`), usado en los periodos, el gráfico y la comprobación de precios de los movimientos
- [ ] Comprobar con datos reales si el histórico viene ajustado por splits y afinar el aviso
- [ ] Desplegar el Worker y probarlo con Yahoo real (solo está probado con respuestas simuladas)
- [ ] Valorar si hace falta caché propia o un segundo respaldo si Yahoo limita las llamadas

### Modelo de datos según el uso real del usuario
- [x] Compras y ventas con el precio en $ o €, y comisiones y total en EUR; lo que falta se calcula
- [x] Precio medio real por título con comisiones incluidas
- [x] Histórico de precios manuales por valor, con gráfico, y precio en dólares o euros con su equivalente
- [x] Cambio del BCE del día de cada movimiento (Frankfurter)
- [x] Moneda principal (euros o dólares) en Seguimiento, con la otra debajo; fecha y hora de cada cotización; % en verde y rojo
- [x] Histórico: el resultado de cada año suma ventas y dividendos netos, con el desglose de ventas, dividendos y cupones por separado (la retención solo en dividendos y cupones)
- [x] Estimación orientativa de lo que se pagaría a Hacienda (base del ahorro, compensación de pérdidas, escala por años), en pantalla y en el Excel
- [ ] Afinar la estimación: deducción por doble imposición internacional, regla de los dos meses y comunidades con escala propia
- [x] Histórico por años desplegable (totales por valor y ventas con sus compras FIFO) y descarga en Excel por año
- [x] Guías de Finnhub y Yahoo dentro de Ajustes
- [x] Cambio de pestaña deslizando
- [x] Ficha de posición: rendimiento a 1 semana, 1 mes, 1 año, 2 y 5 años, y detalle por compra con sus ventas FIFO
- [ ] Alinear el resto del modelo con la hoja de cálculo del usuario (campos, cuentas, divisas)

### Fase 5: fiscalidad completa
Ver `docs/FISCALIDAD.md`, sección «Pendiente».

### Fase 6: rentabilidad
- [ ] TWR (rentabilidad ponderada por tiempo)
- [ ] XIRR (rentabilidad ponderada por dinero, teniendo en cuenta aportaciones)
- [ ] Gráfico de evolución del valor

### Más adelante
- [ ] Importar movimientos desde CSV de brókeres (MyInvestor, Interactive Brokers, Degiro, Trade Republic…)
- [ ] Cifrado opcional del archivo de Drive con contraseña del usuario
- [ ] Movimientos de efectivo y traspasos entre cuentas
- [ ] Política de privacidad publicada (requisito para la verificación de Google si se abre al público)
- [ ] Valorar empaquetado para Google Play (TWA, 25 $)

## Deuda técnica

- **Sesión de Drive caduca cada hora.** En el navegador, Google solo da un acceso de una hora y renovarlo abre una ventana (a veces hace falta un toque). Pedir ese toque cada vez que se abre la app es peor, a nivel de UX, que no estar conectado, así que se deja como está: conexión manual con **Sincronizar**. Salidas: reconexión automática (sin garantías en móvil), token de renovación con el Worker de Cloudflare (el Worker vería los tokens) o app nativa, donde `signInSilently()` renueva sin ventana. Ver `docs/DECISIONES.md`.
- **App nativa.** Cuando todo esté estable, valorar pasar a nativa (Android). El dominio, los tests y el formato de `Snapshot` son lo reutilizable; la interfaz y el acceso a datos habría que reescribirlos.

## Ideas de mejora detectadas

- Al abrir la app conectada a Drive, la píldora pide un toque para reconectar: valorar un aviso más visible si hace días que no se sincroniza.
