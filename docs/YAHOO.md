# Yahoo Finance con un proxy propio

Finnhub gratuito solo cotiza valores de EE. UU. Para BME, Xetra, Euronext, Londres, fondos y ETF europeos, Buho puede usar Yahoo Finance a través de un pequeño proxy **tuyo y gratuito** en Cloudflare Workers. No hace falta tarjeta.

## Por qué hace falta un proxy

- Yahoo no permite que una web lo consulte directamente (CORS), y su API no es oficial.
- El proxy (`worker/yahoo-proxy.js`) hace de puente y devuelve un formato propio y estable. Si Yahoo cambia algo, se arregla en el Worker, sin tocar la app.
- El proxy solo ve los **tickers** que consultas (p. ej. `SAN.MC`). Nunca recibe movimientos, cantidades ni datos de tu cartera.
- Solo responde a las webs de la lista `ALLOWED_ORIGINS` del propio archivo (por defecto, la de Buho en GitHub Pages y `localhost`).

## Instalarlo (10 minutos, una sola vez)

La misma guía está dentro de Buho: **Ajustes → Cotizaciones → Yahoo Finance → «Ver la guía paso a paso»**, con un botón para copiar el código. Estos son los pasos:

1. Crea una cuenta gratuita en <https://dash.cloudflare.com/sign-up> (solo correo y contraseña).
2. Dentro, ve a **Workers y Pages → Crear → Crear Worker**. Ponle de nombre `buho-yahoo` y pulsa **Implementar** (desplegará un «Hello World»).
3. Pulsa **Editar código**. Borra todo lo que hay y pega el contenido completo de `worker/yahoo-proxy.js`. Pulsa **Implementar**.
4. Copia la dirección del Worker. Será algo como `https://buho-yahoo.tu-usuario.workers.dev`.
5. En Buho: **Ajustes → Cotizaciones → Yahoo Finance**. Pega la dirección, pulsa **Guardar dirección** y luego **Probar**. Debe decir «Funciona: Banco Santander (SAN.MC) cotiza a…».

Si usas otra web para Buho (no `gardagon.github.io`), añade su dirección a `ALLOWED_ORIGINS` en el Worker y vuelve a implementarlo.

## Actualizar el proxy

Si Buho añade funciones al proxy, «Probar» avisa de que tu versión es antigua (por ejemplo, sin histórico). Abre tu Worker en Cloudflare → **Editar código** → borra todo → pega el código nuevo de `worker/yahoo-proxy.js` → **Implementar**. La dirección no cambia.

## Cómo se usa

- Con la dirección guardada, **«Seguir un valor»** busca en Yahoo (más mercados, y da la divisa real de cada valor).
- Al actualizar precios, Buho pide primero a Finnhub (si tienes clave) y lo que este no puede cotizar lo pide a Yahoo. Sin clave de Finnhub, todo va por Yahoo.
- Pon el ticker **de Yahoo** en cada activo: `SAN.MC` (Madrid), `SAP.DE` (Xetra), `AIR.PA` (París), `ASML.AS` (Ámsterdam), `ENI.MI` (Milán), `VOD.L` (Londres), `NESN.SW` (Suiza). El buscador te da el símbolo exacto.
- **Histórico:** al actualizar, Buho descarga el histórico diario (hasta 5 años, o desde tu primera compra) de lo que sigues. Sirve para calcular cómo ha ido cada valor a 1 semana, 1 mes, 1 año, 2 y 5 años, y para avisarte si el precio de una compra o venta no cuadra con lo que cotizó ese día. Es una vez al día por valor.
- Ojo con los valores que cotizan en varias bolsas: `BBVA` es el ADR de EE. UU. (en dólares) y `BBVA.MC` es el de Madrid (en euros).

## Límites y riesgos

- El plan gratuito de Cloudflare permite 100.000 peticiones al día. Buho hace una por cada 20 valores y actualización, y el Worker guarda cada respuesta 60 segundos.
- Es una fuente **no oficial**: Yahoo puede cambiar su formato, limitar las llamadas (el aviso será «Yahoo limita las llamadas») o impedir este uso en sus condiciones. Para uso personal con pocas llamadas es poco probable que haya problema, pero no hay garantía. Si deja de funcionar, la app sigue valiendo con precios manuales.
- Las cotizaciones de Yahoo pueden llevar 15 minutos de retraso en algunas bolsas.
- No lo uses para abrir Buho al público sin revisar antes los términos de Yahoo: cada usuario tendría que desplegar su propio proxy, o habría que cambiar de proveedor.
