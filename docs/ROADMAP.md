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

### Fase 4: cotizaciones y valoración
- [ ] `src/quotes/` con la interfaz `PriceProvider` (ver ARQUITECTURA.md)
- [ ] Proveedor Finnhub (REST y, si cabe, WebSocket); comprobar cobertura BME y Xetra
- [ ] Clave API del usuario en Ajustes
- [ ] Tabla `quotes` en Dexie (versión 2 del esquema) con la última cotización
- [ ] Tipos de cambio actuales (Frankfurter/BCE) para valorar en EUR
- [ ] Precio manual para activos sin cotización
- [ ] Cartera: valor de mercado, plusvalía latente por posición y total
- [ ] Pantalla de seguimiento con los valores seleccionados

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
