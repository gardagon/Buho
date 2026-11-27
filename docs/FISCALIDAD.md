# Reglas fiscales (España)

Referencia para los cálculos de `src/domain/portfolio.ts`. Buho calcula de forma **orientativa**; no sustituye a un asesor fiscal ni a la información fiscal del bróker. Antes de implementar una regla nueva, contrástala con la normativa vigente (Ley 35/2006 del IRPF y criterios de la AEAT).

## Implementado

### FIFO en valores homogéneos
En cada venta se consideran vendidos primero los títulos comprados antes (art. 37.2 LIRPF). Se aplica por activo y en todas las cuentas a la vez: si tienes el mismo ISIN en dos brókeres, para Hacienda es una sola cola FIFO.

> Buho agrupa por activo (no por cuenta), así que esto se cumple siempre que el mismo valor se registre como un único activo.

### Comisiones, gastos e impuestos
- Compra: se suman al valor de adquisición (art. 35.1.b LIRPF: gastos y tributos inherentes a la adquisición).
- Venta: se restan del valor de transmisión (art. 35.1.b).
- Los **impuestos de la operación** (p. ej. la tasa sobre transacciones financieras en valores españoles, el timbre británico…) se apuntan aparte, en `Movement.taxes`, y pesan igual que las comisiones en el coste y el valor de transmisión. Separarlos no cambia ningún cálculo: es para reflejar lo que dice el bróker. Los movimientos anteriores lo llevan todo como comisiones hasta que se reparta a mano.

### Importe real en EUR (`Movement.totalEur`)
Si se conoce lo que el bróker cobró (compra) o ingresó (venta) en EUR, ese importe manda: es el valor de adquisición o de transmisión, con comisiones y cambio del bróker ya incluidos. Si no se conoce, se calcula como cantidad × precio ± comisiones ÷ tipo de cambio. El formulario deduce la incógnita que falte (comisiones, precio o cambio efectivo) con `src/domain/trade.ts`. En una operación en divisa con el total y las comisiones puestos y el cambio vacío, se calcula el cambio efectivo (no el del BCE) para que todo cuadre con lo que cobró el bróker; si se escribe un cambio con pocos decimales, el aviso de descuadre ofrece el que cuadra. Si el bróker cobra todo en la divisa de la operación (Revolut en dólares), el selector «Comisiones y total en» permite apuntarlos en esa divisa: Buho los pasa a euros con el cambio de la fecha (el escrito o el del BCE) y el coste o valor de transmisión en euros es ese. Ojo: los brókeres españoles dan el cambio en euros por dólar (0,9286) y Buho lo pide al revés, en dólares por euro (1,0768).

### Divisa
- Coste en EUR = importe en divisa ÷ tipo de cambio de la fecha de compra.
- Ingreso en EUR = importe en divisa ÷ tipo de cambio de la fecha de venta.
- La plusvalía en EUR incluye por tanto el efecto divisa.

### Dividendos y cupones
- Se registran como rendimientos del capital mobiliario: bruto, retención y neto.
- La retención puede apuntarse **separada**: en origen (país extranjero) y en España, cada una con su divisa (euros o la del dividendo), tal como las muestra el bróker. Un movimiento antiguo con una sola retención sigue valiendo y se trata como «sin repartir».
- El **neto cobrado** puede escribirse a mano (lo que realmente ingresó el bróker) y manda sobre bruto − retenciones − comisiones, igual que el total de una venta. Si hay neto y no hay retenciones, la retención es lo que falta hasta el bruto. Todo se calcula en `src/domain/income.ts`.
- **Cambio efectivo:** en un dividendo en divisa, si se escribe el neto cobrado y no el cambio, el cambio se despeja para que bruto, retenciones y comisiones cuadren con lo que el bróker ingresó: `cambio = (bruto − comisiones − retenciones en la divisa) ÷ (neto + retenciones en euros)`. Cada bróker aplica su propio cambio (y no siempre el del día del cobro), así que el del BCE rara vez coincide con el ingreso. Ejemplo (Nvidia): 7,50 $ brutos, 1,13 $ y 1,07 € de retención, 4,55 € ingresados → cambio 1,133452, bruto 6,62 €, retención en origen 1,00 €. La fecha del movimiento es la del cobro; la del ex-dividendo no interviene.

### Regla de los dos meses (`src/domain/twoMonths.ts`)
Art. 33.5.f y g LIRPF: una pérdida por vender valores no computa si se compran valores homogéneos dentro de los **dos meses anteriores o posteriores** a la venta (**un año** si no cotizan, como los fondos de inversión). La pérdida se imputa cuando se venden esos títulos recomprados.

Cómo se aplica (simplificado):
- Solo a las partes de la venta con pérdida (cada lote FIFO por separado).
- Cuentan como recompra los títulos comprados en la ventana que **siguen en cartera tras esa venta** (los que salen en la propia venta no cuentan) y que no respaldan ya otra pérdida.
- Se difiere en proporción: con 40 títulos recomprados de 100 vendidos con pérdida, se difiere el 40 %.
- La pérdida diferida «viaja» con los títulos recomprados: al venderlos, se recupera en esa venta (pro rata). La ventana incluye el día de la venta y el mismo día dos meses después.
- Criptomonedas: no se aplica (no son valores; sin criterio firme de la AEAT).
- La app marca con un triángulo de atención, en **Cartera**, los valores con la ventana abierta (también los que ya no se tienen); al tocarlos, el aviso (hasta cuándo no recomprar) es lo primero en su pantalla. El formulario de compra avisa si la fecha cae dentro de una ventana.
- `YearReport.taxableNetEur` es el saldo de ventas que computa (`netEur` + diferidas − recuperadas) y es el que usa la estimación de Hacienda.

Límites: no distingue valores homogéneos por ISIN distinto (se agrupa por activo), ni trata las cadenas de recompras con pérdidas sucesivas más allá de lo descrito.

### Traspaso entre fondos (art. 94 LIRPF)
Movimiento «Traspaso»: no tributa. Las participaciones salen del fondo de origen por FIFO y el fondo de destino **hereda la fecha de compra y el coste** de cada lote (el coste de cada lote se reparte entre las participaciones recibidas en proporción). Al vender desde el destino se usan esas fechas y costes, así que el FIFO del destino sigue la fecha original y no la del traspaso. Se apunta con las participaciones que salen y las que entran.

Límites: no se ha contrastado con un caso real; solo vale entre fondos ya dados de alta; la regla de los dos meses no sigue los lotes entre fondos; el rendimiento por periodos de la ficha ignora el valor movido por el traspaso dentro del periodo.

### Dividendo flexible o scrip dividend (`src/domain/scrip.ts`)
La empresa reparte un derecho por cada acción y cada accionista elige qué hacer con ellos. Movimiento «Dividendo flexible» (`type: 'scrip'`). Cada opción tributa distinto (art. 37.1.a LIRPF, según la redacción vigente desde 2017):

| Qué se hace con los derechos | Cómo tributa | Dónde aparece en Buho |
| --- | --- | --- |
| Cambiarlos por acciones nuevas (ampliación liberada) | No tributa al recibirlas | Cartera: más acciones con el mismo coste total |
| Vendérselos a la empresa a precio fijo | Rendimiento del capital mobiliario (como un dividendo), retención del 19 % | Dividendos, con la etiqueta «Dividendo flexible» |
| Venderlos en el mercado | Ganancia patrimonial por todo lo cobrado (coste 0), retención del 19 % | Ventas, como «Venta de derechos» |

**Acciones nuevas.** No se reciben a coste cero: el coste de las acciones antiguas se reparte entre las antiguas y las nuevas que les corresponden, y las nuevas conservan la **fecha de compra** de las acciones de las que proceden.

**Reparto entre lotes:**
1. Cada acción da un derecho. Si el número de derechos apuntado es menor que el de acciones (compras posteriores a la fecha de corte), los derechos salen de las compras más antiguas.
2. Si no se venden todos los derechos, la ley dice que los vendidos son los de **los valores comprados en primer lugar** (FIFO). Los derechos sobrantes que no se apuntan como vendidos se tratan igual.
3. Las acciones nuevas salen de los derechos que quedan (los de las compras más recientes): cada lote recibe acciones nuevas × sus derechos cambiados ÷ derechos cambiados. Pueden ser fracciones.
4. Cada lote suma sus acciones nuevas y su coste por acción baja: el coste total y la fecha del lote no cambian.

Ejemplo (caso de prueba en `portfolio.test.ts`): lote 1 con 30 acciones a 9 € (270 €) y lote 2, posterior, con 20 a 12 € (240 €). Scrip de 1 acción por cada 36 derechos: 50 derechos dan 1 acción y sobran 14, que se venden.
- Los 14 vendidos salen del lote 1. Quedan 16 derechos del lote 1 y 20 del lote 2.
- La acción nueva va 16/36 al lote 1 y 20/36 al lote 2.
- Lote 1: 30,4444 acciones a 8,8686 € (270 €). Lote 2: 20,5556 acciones a 11,6757 € (240 €). Total: 51 acciones y 510 €.

Con un solo lote da igual el criterio: 50 acciones a 10 € pasan a 51 acciones a 9,8039 €. Entre criterios de reparto solo cambian las ventas parciales futuras; si se vende todo, la plusvalía total es la misma.

**Venta de derechos en el mercado.** Ganancia patrimonial del año de la venta por el importe bruto menos comisiones (coste 0). Se integra con las demás ganancias y pérdidas patrimoniales y su retención se resta de la cuota como retención en España.

**Venta de derechos a la empresa.** Cuenta como dividendo: tributa por el bruto y su retención se resta de la cuota.

Límites:
- No contempla **comprar derechos** para completar una acción más: avisa si las acciones nuevas necesitan más derechos de los que quedan.
- La regla de los dos meses no cuenta las acciones liberadas como recompra (no son una adquisición onerosa). Está por contrastar.
- Es la regla de las ampliaciones liberadas españolas. En otros países el scrip suele tratarse como dividendo en especie; para valores extranjeros conviene revisarlo aparte.
- Que el FIFO de los derechos se aplique igual cuando se venden a la empresa es una interpretación: la ley habla de «transmisión» de derechos, sin distinguir a quién.

### Estimación de la cuota del ahorro (`src/domain/tax.ts`)
Aproximación de lo que se pagaría por la base imponible del ahorro de cada año, en territorio común. Se muestra en Cartera → Histórico, dentro de cada año, con el cálculo a la vista, y en una hoja del Excel.

**Qué entra:** el saldo de ganancias y pérdidas patrimoniales por ventas del año (incluidas las ventas de derechos en el mercado) y los dividendos y cupones **brutos** (rendimientos del capital mobiliario, incluidos los derechos vendidos a la empresa).

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

**Resultado:** cuota − deducción por doble imposición − retenciones practicadas en España (incluida la de las ventas de derechos) = a pagar (o a devolver, si es negativo).

**Límites conocidos (la app los dice en pantalla):**
- Solo cuenta lo que hay en Buho: si faltan años anteriores, faltan sus pérdidas pendientes.
- Aplica la regla de los dos meses de forma simplificada (ver arriba). Incluye la venta de derechos de dividendos flexibles, pero no la compra de derechos ni los gastos de administración y custodia.
- Territorio común: País Vasco y Navarra tienen escala propia.
- Es una ayuda para hacerse una idea; no sustituye al borrador de la Agencia Tributaria.

Casos de prueba calculados a mano en `src/domain/tax.test.ts`.

## Pendiente (orden sugerido)

1. **Splits y contrasplits:** cambian la cantidad y el coste unitario de los lotes sin alterar el coste total ni las fechas. Nuevo tipo de movimiento.
2. **Compra de derechos** (para completar una acción más en un dividendo flexible) y derechos de ampliaciones no liberadas.
3. **Informe para la declaración:** por año, ventas con fecha y valor de adquisición y transmisión por lote, como las pide el modelo 100.

## Casos de prueba de referencia

Están en `src/domain/portfolio.test.ts`. Cualquier regla nueva necesita al menos un caso calculado a mano con el resultado esperado escrito en el comentario.
