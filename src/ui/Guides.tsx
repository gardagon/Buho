import { useState, type ReactNode } from 'react'
import workerCode from '../../worker/yahoo-proxy.js?raw'
import { Sheet } from './Sheet'

export type GuideId = 'finnhub' | 'yahoo'

const ext = (href: string, label: string) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {label}
  </a>
)

function Steps({ children }: { children: ReactNode }) {
  return <ol className="guide-steps">{children}</ol>
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Sin permiso del portapapeles (p. ej. fuera de https): se copia con un campo temporal.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

function FinnhubGuide() {
  return (
    <>
      <p>
        Finnhub da cotizaciones gratis a cambio de una clave personal. Se consigue en unos 2 minutos, sin tarjeta. Con el plan
        gratuito solo cotizan los valores de EE. UU.; para BME, Xetra y el resto de Europa usa la guía de Yahoo.
      </p>
      <Steps>
        <li>
          Abre {ext('https://finnhub.io/register', 'finnhub.io/register')} y crea la cuenta con tu correo y una contraseña
          (o con Google o GitHub). Confirma el correo si te lo pide.
        </li>
        <li>
          Entra en tu panel: {ext('https://finnhub.io/dashboard', 'finnhub.io/dashboard')}. Arriba verás el recuadro{' '}
          <strong>«API Key»</strong> con tu clave escondida en puntos.
        </li>
        <li>
          Pulsa el icono del <strong>ojo</strong> para verla entera, o el de <strong>copiar</strong> (dos cuadraditos) para
          copiarla directamente.
        </li>
        <li>
          Vuelve aquí, pega la clave en «Clave de Finnhub» y pulsa <strong>Guardar clave</strong>. Buho actualizará los
          precios solo.
        </li>
      </Steps>
      <h3 className="list-title">Ojo con estas cosas</h3>
      <ul className="guide-notes">
        <li>
          Más abajo, en «Webhook», hay un «Secret» que se parece a la clave. <strong>No es esa:</strong> no funciona en Buho.
          Tampoco pulses «Regenerate»: invalidaría tu clave.
        </li>
        <li>
          La clave se guarda solo en este dispositivo: no se sube a Drive ni a ningún sitio. Si usas Buho en otro móvil u
          ordenador, tendrás que ponerla también allí.
        </li>
        <li>No la compartas con nadie. Si crees que se ha filtrado, regenérala en el panel de Finnhub y pega la nueva.</li>
        <li>
          Si Buho dice <em>«La clave de Finnhub no es válida»</em>, revisa que no haya espacios al principio o al final, o que
          hayas copiado la «API Key» y no el «Secret».
        </li>
        <li>El plan gratuito permite 60 consultas por minuto, de sobra para una cartera personal.</li>
      </ul>
    </>
  )
}

function YahooGuide() {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  return (
    <>
      <p>
        Yahoo Finance cubre BME, Xetra, Euronext, Londres, ETF y fondos europeos, y no pide clave. Pero no deja que una web lo
        consulte directamente, así que montas <strong>un pequeño proxy tuyo y gratuito</strong> en Cloudflare. Se hace una sola
        vez y tarda unos 10 minutos.
      </p>
      <p className="small muted">
        El proxy solo ve los símbolos que consultas (por ejemplo SAN.MC). Nunca recibe tus movimientos, cantidades ni datos de la
        cartera. Es una fuente no oficial: Yahoo puede cambiar o limitar, y si falla, los precios manuales siguen valiendo.
      </p>

      <Steps>
        <li>
          Crea una cuenta gratuita en {ext('https://dash.cloudflare.com/sign-up', 'dash.cloudflare.com/sign-up')} (correo y
          contraseña, sin tarjeta) y confirma el correo.
        </li>
        <li>
          En el panel, ve a <strong>Workers y Pages</strong> (<em>Workers &amp; Pages</em>) → <strong>Crear</strong> (
          <em>Create</em>) → <strong>Crear Worker</strong>. Ponle de nombre <code>buho-yahoo</code> y pulsa{' '}
          <strong>Implementar</strong> (<em>Deploy</em>). Desplegará una página de prueba.
        </li>
        <li>
          Pulsa <strong>Editar código</strong> (<em>Edit code</em>). Selecciona todo el texto que hay y bórralo. Copia el código
          de Buho con este botón y pégalo en su lugar:
          <div className="actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn small"
              onClick={async () => setCopied((await copy(workerCode)) ? 'ok' : 'fail')}
            >
              Copiar el código
            </button>
            {copied === 'ok' && <span className="small gain">Copiado. Pégalo en el editor de Cloudflare.</span>}
            {copied === 'fail' && <span className="small loss">No se pudo copiar. Selecciona el código de abajo y cópialo a mano.</span>}
          </div>
          <details style={{ marginTop: 8 }}>
            <summary className="small muted">Ver el código</summary>
            <pre className="guide-code">{workerCode}</pre>
          </details>
          Después pulsa <strong>Implementar</strong> otra vez.
        </li>
        <li>
          Copia la dirección de tu Worker, que aparece arriba o en su página principal. Será como{' '}
          <code>https://buho-yahoo.tu-usuario.workers.dev</code>.
        </li>
        <li>
          Vuelve a Buho, pégala en «Dirección del proxy» (en este mismo apartado de Ajustes), pulsa{' '}
          <strong>Guardar dirección</strong> y luego <strong>Probar</strong>. Debe decir «Funciona».
        </li>
      </Steps>

      <h3 className="list-title">Cómo usarlo</h3>
      <ul className="guide-notes">
        <li>
          Con la dirección guardada, «Seguir un valor» busca en Yahoo y da la divisa real de cada valor. Al actualizar, lo que
          Finnhub no cubra pasa a Yahoo. Además se descarga el <strong>histórico</strong> de precios (hasta 5 años, o desde tu
          primera compra) para calcular los periodos y comprobar tus movimientos.
        </li>
        <li>
          Pon el ticker <strong>de Yahoo</strong> en cada activo: <code>SAN.MC</code> (Madrid), <code>SAP.DE</code> (Xetra),{' '}
          <code>AIR.PA</code> (París), <code>ASML.AS</code> (Ámsterdam), <code>ENI.MI</code> (Milán), <code>VOD.L</code>{' '}
          (Londres), <code>NESN.SW</code> (Suiza). El buscador te da el símbolo exacto.
        </li>
        <li>
          Cuidado con los valores que cotizan en varias bolsas: <code>BBVA</code> es el de EE. UU. (en dólares) y{' '}
          <code>BBVA.MC</code> el de Madrid (en euros).
        </li>
      </ul>

      <h3 className="list-title">Actualizar el proxy</h3>
      <p>
        Cuando Buho añada algo nuevo al proxy (por ejemplo el histórico), «Probar» te avisará de que tu versión es antigua. Para
        actualizarla: abre tu Worker en Cloudflare → <strong>Editar código</strong> → borra todo → pega el código con el botón
        de arriba → <strong>Implementar</strong>. La dirección no cambia.
      </p>

      <h3 className="list-title">Si algo falla</h3>
      <ul className="guide-notes">
        <li>
          <em>«Origen no permitido»</em> o error 403: usas Buho desde una dirección que no está en la lista{' '}
          <code>ALLOWED_ORIGINS</code> del código. Añádela ahí y vuelve a implementar.
        </li>
        <li>
          <em>«Yahoo limita las llamadas»</em>: espera unos minutos. Pasa a veces cuando se hacen muchas peticiones seguidas.
        </li>
        <li>
          <em>«Yahoo no tiene datos de…»</em>: el ticker no es el de Yahoo. Búscalo con «Seguir un valor».
        </li>
        <li>
          Error 404 al pedir el histórico: tu proxy es de una versión antigua. Actualízalo como se explica arriba.
        </li>
      </ul>
      <p className="small muted">
        El plan gratuito de Cloudflare permite 100.000 peticiones al día; Buho usa muy pocas. Los nombres de los botones de
        Cloudflare pueden variar un poco según el idioma y la versión de su panel.
      </p>
    </>
  )
}

export function Guide({ id, onClose }: { id: GuideId; onClose: () => void }) {
  return (
    <Sheet
      title={id === 'finnhub' ? 'Cómo conseguir tu clave de Finnhub' : 'Cómo montar el proxy de Yahoo'}
      onClose={onClose}
      onSubmit={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="submit" className="btn primary">
            Entendido
          </button>
        </>
      }
    >
      <div className="guide">{id === 'finnhub' ? <FinnhubGuide /> : <YahooGuide />}</div>
    </Sheet>
  )
}
