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
- La retención puede apuntarse **separada**: en origen (país extranjero) y en España, cada una con su divisa (euros o la del dividendo), tal como las muestra el bróker. Un movimiento antiguo con una sola retención sigue valiendo y se trata como «sin repartir».
- El **neto cobrado** puede escribirse a mano (lo que realmente ingresó el bróker) y manda sobre bruto − retenciones − comisiones, igual que el total de una venta. Si hay neto y no hay retenciones, la retención es lo que falta hasta el bruto. Todo se calcula en `src/domain/income.ts`.

### Regla de los dos meses (`src/domain/twoMonths.ts`)
Art. 33.5.f y g LIRPF: una pérdida por vender valores no computa si se compran valores homogéneos dentro de los **dos meses anteriores o posteriores** a la venta (**un año** si no cotizan, como los fondos de inversión). La pérdida se imputa cuando se venden esos títulos recomprados.

Cómo se aplica (simplificado):
- Solo a las partes de la venta con pérdida (cada lote FIFO por separado).
- Cuentan como recompra los títulos comprados en la ventana que **siguen en cartera tras esa venta** (los que salen en la propia venta no cuentan) y que no respaldan ya otra pérdida.
- Se difiere en proporción: con 40 títulos recomprados de 100 vendidos con pérdida, se difiere el 40 %.
- La pérdida diferida «viaja» con los títulos recomprados: al venderlos, se recupera en esa venta (pro rata). La ventana incluye el día de la venta y el mismo día dos meses después.
- Criptomonedas: no se aplica (no son valores; sin criterio firme de la AEAT).
- La app avisa en **Cartera** y **Seguimiento** de qué valores no conviene recomprar todavía y hasta cuándo, y en el formulario de compra si la fecha cae dentro de una ventana.
- `YearReport.taxableNetEur` es el saldo de ventas que computa (`netEur` + diferidas − recuperadas) y es el que usa la estimación de Hacienda.

Límites: no distingue valores homogéneos por ISIN distinto (se agrupa por activo), ni trata las cadenas de recompras con pérdidas sucesivas más allá de lo descrito.

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

**Doble imposición internacional (art. 80 LIRPF):** la retención practicada en el país de origen se deduce de la cuota. La deducción es el menor de:
1. lo retenido en origen, limitado al **15 % del bruto de cada cobro** (máximo habitual de los convenios; el exceso no se deduce y se reclama al país de origen), y
2. el tipo medio efectivo de la cuota aplicado al bruto cobrado en el extranjero.

Además, nunca supera la cuota. Los dividendos «con retención en origen» son los que tienen ese dato apuntado; no se distingue país. Una retención sin repartir entre origen y España (movimientos antiguos) se trata como retención en España.

**Resultado:** cuota − deducción por doble imposición − retenciones practicadas en España = a pagar (o a devolver, si es negativo).

**Límites conocidos (la app los dice en pantalla):**
- Solo cuenta lo que hay en Buho: si faltan años anteriores, faltan sus pérdidas pendientes.
- Aplica la regla de los dos meses de forma simplificada (ver arriba). No contempla los derechos de suscripción ni gastos de administración y custodia.
- Territorio común: País Vasco y Navarra tienen escala propia.
- Es una ayuda para hacerse una idea; no sustituye al borrador de la Agencia Tributaria.

Casos de prueba calculados a mano en `src/domain/tax.test.ts`.

## Pendiente (orden sugerido)

1. **Splits y contrasplits:** cambian la cantidad y el coste unitario de los lotes sin alterar el coste total ni las fechas. Nuevo tipo de movimiento.
2. **Traspasos entre fondos de inversión** (art. 94 LIRPF): no tributan; el fondo de destino hereda las fechas y costes de los lotes del de origen. Nuevo tipo de movimiento.
3. **Derechos de suscripción y scrip dividends:** desde 2017 la venta de derechos de valores cotizados tributa como ganancia patrimonial con retención.
4. **Informe para la declaración:** por año, ventas con fecha y valor de adquisición y transmisión por lote, como las pide el modelo 100.

## Casos de prueba de referencia

Están en `src/domain/portfolio.test.ts`. Cualquier regla nueva necesita al menos un caso calculado a mano con el resultado esperado escrito en el comentario.
