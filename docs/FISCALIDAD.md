# Reglas fiscales (España)

Referencia para los cálculos de `src/domain/portfolio.ts`. Buho calcula de forma **orientativa**; no sustituye a un asesor fiscal ni a la información fiscal del bróker. Antes de implementar una regla nueva, contrástala con la normativa vigente (Ley 35/2006 del IRPF y criterios de la AEAT).

## Implementado

### FIFO en valores homogéneos
En cada venta se consideran vendidos primero los títulos comprados antes (art. 37.2 LIRPF). Se aplica por activo y en todas las cuentas a la vez: si tienes el mismo ISIN en dos brókeres, para Hacienda es una sola cola FIFO.

> Buho agrupa por activo (no por cuenta), así que esto se cumple siempre que el mismo valor se registre como un único activo.

### Comisiones y gastos
- Compra: se suman al valor de adquisición.
- Venta: se restan del valor de transmisión.

### Importe real en EUR (`Movement.totalEur`)
Si se conoce lo que el bróker cobró (compra) o ingresó (venta) en EUR, ese importe manda: es el valor de adquisición o de transmisión, con comisiones y cambio del bróker ya incluidos. Si no se conoce, se calcula como cantidad × precio ± comisiones ÷ tipo de cambio. El formulario deduce la incógnita que falte (comisiones, precio o cambio efectivo) con `src/domain/trade.ts`.

### Divisa
- Coste en EUR = importe en divisa ÷ tipo de cambio de la fecha de compra.
- Ingreso en EUR = importe en divisa ÷ tipo de cambio de la fecha de venta.
- La plusvalía en EUR incluye por tanto el efecto divisa.

### Dividendos y cupones
- Se registran como rendimientos del capital mobiliario: bruto, retención y neto.
- La retención incluye la de origen (país extranjero) y la de destino (España). Para la deducción por doble imposición internacional hará falta separarlas (pendiente).

## Pendiente (orden sugerido)

1. **Regla de los dos meses** (art. 33.5.f LIRPF): si hay pérdida en la venta de valores cotizados y se recompran valores homogéneos en los dos meses anteriores o posteriores, la pérdida no se computa hasta que se vendan esos valores recomprados. Para valores no cotizados el plazo es de un año (art. 33.5.g). Hay que marcar la pérdida como diferida e imputarla cuando salgan los títulos recomprados.
2. **Splits y contrasplits:** cambian la cantidad y el coste unitario de los lotes sin alterar el coste total ni las fechas. Nuevo tipo de movimiento.
3. **Traspasos entre fondos de inversión** (art. 94 LIRPF): no tributan; el fondo de destino hereda las fechas y costes de los lotes del de origen. Nuevo tipo de movimiento.
4. **Derechos de suscripción y scrip dividends:** desde 2017 la venta de derechos de valores cotizados tributa como ganancia patrimonial con retención.
5. **Separar retención en origen y en destino** para calcular la deducción por doble imposición internacional (límite: lo que se pagaría en España por esa renta).
6. **Informe para la declaración:** por año, ventas con fecha y valor de adquisición y transmisión por lote, como las pide el modelo 100.

## Casos de prueba de referencia

Están en `src/domain/portfolio.test.ts`. Cualquier regla nueva necesita al menos un caso calculado a mano con el resultado esperado escrito en el comentario.
