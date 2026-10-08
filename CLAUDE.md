# Buho: guía para Claude

App personal de seguimiento de inversiones (acciones, ETF, fondos, bonos, materias primas, cripto) para un inversor residente en España. PWA instalable, local-first, sin servidor, coste cero. Publicada en https://gardagon.github.io/Buho/.

**Idioma:** todo en español de España: interfaz, comentarios, mensajes de commit, documentación y respuestas al usuario. Los identificadores de código van en inglés (`Movement`, `computePortfolio`); los textos visibles, en español.

## Antes de tocar nada, lee

- `docs/ARQUITECTURA.md`: cómo está montada la app, flujo de datos y sincronización.
- `docs/DECISIONES.md`: por qué se eligió cada cosa (PWA, Drive `drive.file`, proveedores de cotizaciones…). No reabras una decisión sin motivo nuevo.
- `docs/FISCALIDAD.md`: reglas de cálculo de plusvalías en España. Cualquier cambio en `src/domain/portfolio.ts` debe respetarlas.
- `docs/ROADMAP.md`: qué está hecho y qué toca después.

## Comandos

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: cálculo FIFO, fusión de copias, IndexedDB
npm run build      # tsc --noEmit + vite build (genera dist/ y el service worker)
npx pwa-assets-generator   # regenera los iconos desde public/logo.png
```

Antes de dar algo por terminado: `npm test` y `npm run build` deben pasar.

## Reglas que no se rompen

1. **Coste cero.** Nada de servidores, bases de datos alojadas ni servicios de pago. Si algo lo necesita, propónlo antes y explica el coste.
2. **Los datos del usuario nunca salen de su dispositivo y su Google Drive.** El repositorio jamás contiene datos reales ni claves. Las claves de API de cotizaciones las introduce cada usuario y se guardan en su dispositivo.
3. **Dinero con `decimal.js`, nunca `number`.** Importes y cantidades se guardan como texto (`"123.45"`). Solo se convierten a `number` para formatear en pantalla.
4. **Nada se borra físicamente.** Se marca `deleted: true` y se actualiza `updatedAt`, para que la eliminación se propague al sincronizar.
5. **Todo cambio de un registro actualiza `updatedAt`.** La fusión entre dispositivos depende de ello. Usa siempre las funciones de `src/data/repo.ts`, no escribas en Dexie directamente desde la UI.
6. **El formato del archivo de Drive (`Snapshot`, versión 1) es un contrato.** Si cambias tipos en `src/domain/types.ts`, los campos nuevos deben ser opcionales o hay que subir `version` y escribir una migración en `parseSnapshot`.
7. **El dominio no depende de la UI.** `src/domain/` es TypeScript puro y testeable; no importa React ni Dexie.
8. **Lógica fiscal nueva = test nuevo** en `src/domain/portfolio.test.ts`, con un caso numérico comprobado a mano.

## Estilo de la interfaz

- Móvil primero; en ≥900 px la navegación pasa a una barra lateral.
- Colores como variables CSS en `src/styles.css` (claro y oscuro). Acento ámbar `--amber` (los ojos del búho) solo para la acción principal y la marca.
- Tipografía Hanken Grotesk (autoalojada con `@fontsource`, para que funcione sin conexión). Cifras con `.num` (números tabulares).
- Textos: frases cortas, voz activa, sin tecnicismos. Los botones dicen lo que hacen («Añadir movimiento», no «Enviar»). Los errores dicen qué pasó y cómo arreglarlo.
- Sin etiquetas en mayúsculas, sin decoración que no informe.

## Despliegue

Push a `main` → GitHub Actions (`.github/workflows/deploy.yml`) pasa tests, construye y publica en GitHub Pages. El ID de cliente de Google llega como variable de repositorio `GOOGLE_CLIENT_ID` → `VITE_GOOGLE_CLIENT_ID`.

## Commits

Mensajes en español, en imperativo y con una primera línea de menos de 72 caracteres («Añade cotizaciones con Finnhub»).
