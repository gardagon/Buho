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

### Pendiente: proveedor de cotizaciones sin registro (decidir)
- [ ] Probar Alpha Vantage (clave por formulario, 25 peticiones/día): ¿cubre Madrid y Xetra y se puede llamar desde el navegador?
- [ ] Alternativa: Cloudflare Worker gratuito como proxy de Yahoo Finance (sin clave para el usuario, pero fuente no oficial)

### Modelo de datos según el uso real del usuario
- [x] Compras y ventas con el precio en $ o €, y comisiones y total en EUR; lo que falta se calcula
- [x] Precio medio real por título con comisiones incluidas
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

## Ideas de mejora detectadas

- El estado vacío de Cartera muestra a la vez el botón central y el flotante; quizá ocultar el flotante cuando no hay datos.
- Al abrir la app conectada a Drive, la píldora pide un toque para reconectar: valorar un aviso más visible si hace días que no se sincroniza.
