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

### Estimación de la cuota del ahorro (`src/domain/tax.ts`)
Aproximación de lo que se pagaría por la base imponible del ahorro de cada año, en territorio común. Se muestra en Cartera → Histórico, dentro de cada año, con el cálculo a la vista, y en una hoja del Excel.

**Qué entra:** el saldo de ganancias y pérdidas patrimoniales por ventas del año y los dividendos y cupones **brutos** (rendimientos del capital mobiliario).

**Integración y compensación (art. 49 LIRPF):**
1. Las ganancias y pérdidas por ventas se compensan entre sí sin límite.
2. Las pérdidas de los 4 años anteriores que sigan pendientes se aplican, de la más antigua a la más reciente, contra las ganancias del año.
3. Si queda un saldo negativo (del año o de años anteriores), solo se compensa con los dividendos y cupones hasta el **25 %** de estos. Ese límite lo comparten las pérdidas del año y las arrastradas; se aplica primero a las más antiguas.
4. Lo que no se compensa queda pendiente 4 años (se indica cuánto y hasta cuándo).

**Escala del ahorro (art. 66 LIRPF, estatal + autonómica):**

| Base | ≤ 2020 | 2021-2023 | 2024 | desde 2025 |
| --- | --- | --- | --- | --- |
| Hasta 6.000 € | 19 % | 19 % | 19 % | 19 % |
| 6.000 – 50.000 € | 21 % | 21 % | 21 % | 21 % |
| 50.000 – 200.000 € | 23 % | 23 % | 23 % | 23 % |
| 200.000 – 300.000 € | 23 % | 26 % | 27 % | 27 % |
| Más de 300.000 € | 23 % | 26 % | 28 % | 30 % |

Las fuentes consultadas discrepan sobre el último tramo de 2025 y 2026 (28 % o 30 %); solo afecta a bases de más de 300.000 €, y la app lo avisa. Para años anteriores a 2016 se usa la escala de 2016.

**Resultado:** cuota − retenciones e ingresos a cuenta de los dividendos y cupones = a pagar (o a devolver, si es negativo).

**Límites conocidos (la app los dice en pantalla):**
- Solo cuenta lo que hay en Buho: si faltan años anteriores, faltan sus pérdidas pendientes.
- No aplica la regla de los dos meses (ver «Pendiente»), la deducción por doble imposición internacional (se resta toda la retención como si fuera española), los derechos de suscripción ni gastos de administración y custodia.
- Territorio común: País Vasco y Navarra tienen escala propia.
- Es una ayuda para hacerse una idea; no sustituye al borrador de la Agencia Tributaria.

Casos de prueba calculados a mano en `src/domain/tax.test.ts`.

## Pendiente (orden sugerido)

1. **Regla de los dos meses** (art. 33.5.f LIRPF): si hay pérdida en la venta de valores cotizados y se recompran valores homogéneos en los dos meses anteriores o posteriores, la pérdida no se computa hasta que se vendan esos valores recomprados. Para valores no cotizados el plazo es de un año (art. 33.5.g). Hay que marcar la pérdida como diferida e imputarla cuando salgan los títulos recomprados.
2. **Splits y contrasplits:** cambian la cantidad y el coste unitario de los lotes sin alterar el coste total ni las fechas. Nuevo tipo de movimiento.
3. **Traspasos entre fondos de inversión** (art. 94 LIRPF): no tributan; el fondo de destino hereda las fechas y costes de los lotes del de origen. Nuevo tipo de movimiento.
4. **Derechos de suscripción y scrip dividends:** desde 2017 la venta de derechos de valores cotizados tributa como ganancia patrimonial con retención.
5. **Separar retención en origen y en destino** para calcular la deducción por doble imposición internacional (límite: lo que se pagaría en España por esa renta).
6. **Informe para la declaración:** por año, ventas con fecha y valor de adquisición y transmisión por lote, como las pide el modelo 100.

## Casos de prueba de referencia

Están en `src/domain/portfolio.test.ts`. Cualquier regla nueva necesita al menos un caso calculado a mano con el resultado esperado escrito en el comentario.
