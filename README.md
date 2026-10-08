# Buho

Seguimiento personal de inversiones: acciones, ETF, fondos, bonos, materias primas y cripto.

- **Instalable** en Android, iPhone y ordenador desde el navegador (PWA). Funciona sin conexión.
- **Sin servidores.** Los datos viven en tu dispositivo (IndexedDB) y, si quieres, en un archivo de tu Google Drive.
- **Coste cero.** Se aloja gratis en GitHub Pages.

## Qué hace ya

| Fase | Estado |
| --- | --- |
| Registro de activos y movimientos (compra, venta, dividendo, cupón) | Hecho |
| Posiciones a coste con FIFO, comisiones y tipo de cambio por operación | Hecho |
| Plusvalías realizadas y rendimientos por año | Hecho (orientativo) |
| Sincronización con Google Drive y copias de seguridad en archivo | Hecho |
| Cotizaciones en vivo y valoración a mercado | Pendiente |
| Regla de los dos meses, splits, traspasos entre fondos | Pendiente |

## Dónde se guardan los datos

| Qué | Dónde |
| --- | --- |
| Código de la app | Este repositorio, publicado en GitHub Pages |
| Tus activos y movimientos | IndexedDB del navegador de cada dispositivo |
| Copia y sincronización | `buho-cartera.json` en tu Google Drive (opcional) |

El repositorio nunca contiene datos de nadie. No subas copias reales de tu cartera (el `.gitignore` ya excluye `buho-cartera*.json`).

### Cómo funciona la sincronización

La app usa el permiso `drive.file` de Google: **solo puede ver los archivos que crea ella misma**, no el resto de tu Drive. Al sincronizar descarga `buho-cartera.json`, lo fusiona registro a registro con los datos locales (gana el cambio más reciente de cada registro) y lo vuelve a subir. Nada se borra físicamente: las eliminaciones se marcan, así que también llegan a los otros dispositivos.

El acceso a Google dura una hora y no se guarda en el dispositivo. Al abrir la app, toca **Sincronizar** arriba a la derecha para reconectar.

## Puesta en marcha

### 1. Publicar en GitHub Pages

1. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Cada push a `main` pasa los tests, construye y publica en `https://<usuario>.github.io/Buho/`.

### 2. Crear el ID de cliente de Google (gratis)

1. Entra en [Google Cloud Console](https://console.cloud.google.com/) y crea un proyecto (por ejemplo, «Buho»).
2. **APIs y servicios → Biblioteca**: activa **Google Drive API**.
3. **Pantalla de consentimiento de OAuth**: tipo *Externo*, nombre «Buho», tu correo como contacto.
   - En **Permisos de datos** añade `.../auth/drive.file`.
   - En **Público**, deja la app en modo *Prueba* y añade tu cuenta de Gmail como usuario de prueba.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: *Aplicación web*.
   - Orígenes de JavaScript autorizados: `https://<usuario>.github.io` y `http://localhost:5173`.
   - No hace falta URI de redirección.
5. Copia el ID de cliente (`….apps.googleusercontent.com`). **Es público por diseño**: identifica la app, pero no da acceso a nada sin que el usuario lo autorice.
6. En GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable** con nombre `GOOGLE_CLIENT_ID` y ese valor. Vuelve a lanzar el workflow.

También puedes pegarlo en la app, en **Ajustes → Google Drive → Configuración avanzada**, sin volver a publicar.

> **Para lanzarla al público:** mientras esté en modo *Prueba*, solo entran las cuentas que añadas (hasta 100). Para abrirla a todos hay que pasar la verificación de Google, que con `drive.file` es gratuita pero pide una política de privacidad publicada y un dominio verificado.

### 3. Instalarla

- **Android (Chrome):** abre la web → menú ⋮ → *Instalar aplicación*.
- **iPhone (Safari):** abre la web → Compartir → *Añadir a pantalla de inicio*.
- **Ordenador (Chrome, Edge):** icono de instalar en la barra de direcciones.

## Desarrollo

```bash
npm install
cp .env.example .env.local   # opcional: pon tu VITE_GOOGLE_CLIENT_ID
npm run dev                  # http://localhost:5173
npm test                     # tests de cálculo, fusión y base de datos
npm run build
```

### Documentación del proyecto

- [`CLAUDE.md`](CLAUDE.md): reglas para desarrollar con Claude Code (también útiles para personas)
- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md): cómo está montada la app
- [`docs/DECISIONES.md`](docs/DECISIONES.md): por qué se eligió cada cosa
- [`docs/FISCALIDAD.md`](docs/FISCALIDAD.md): reglas de cálculo de plusvalías en España
- [`docs/ROADMAP.md`](docs/ROADMAP.md): qué está hecho y qué falta

### Estructura

```
src/
  domain/   tipos, números decimales y cálculo de cartera (FIFO). Sin dependencias de la UI.
  data/     IndexedDB (Dexie), altas/bajas/cambios y fusión de copias
  sync/     Google Identity Services, API de Drive y estado de sincronización
  ui/       pantallas y formularios (React)
```

### Decisiones técnicas

- **Importes como texto + `decimal.js`.** Nunca `number`, para evitar errores de coma flotante.
- **Tipo de cambio por operación**, expresado como unidades de divisa por 1 EUR (como el BCE). La plusvalía en EUR incluye el efecto divisa, como pide Hacienda.
- **FIFO** por activo: en cada venta salen primero los títulos más antiguos. Las comisiones suman al coste de compra y restan del importe de venta.
- **Registros con `id` UUID y `updatedAt`** para poder fusionar copias de varios dispositivos sin servidor.

## Aviso

Buho es una herramienta personal. Los cálculos fiscales son orientativos y no sustituyen el asesoramiento de un profesional ni los datos fiscales de tu bróker.
