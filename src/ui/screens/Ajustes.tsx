import { useEffect, useRef, useState } from 'react'
import { getMeta, setMeta } from '../../data/db'
import { QUOTE_META } from '../../data/repo'
import { useQuotes } from '../../quotes/QuotesContext'
import { normalizeProxyUrl, testYahooProxy } from '../../quotes/yahoo'
import { parseSnapshot } from '../../data/merge'
import { exportSnapshot, mergeIntoLocal, wipeLocalData } from '../../data/repo'
import { META } from '../../sync/sync'
import { useSync } from '../../sync/SyncContext'
import { useToast } from '../Toast'

const timeFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' })

export function Ajustes() {
  const s = useSync()
  const toast = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [clientId, setClientId] = useState('')
  const quotes = useQuotes()
  const [finnhubKey, setFinnhubKey] = useState('')
  const [yahooProxy, setYahooProxy] = useState('')
  const [testing, setTesting] = useState(false)
  const envClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  useEffect(() => {
    void getMeta<string>(META.clientId).then((v) => setClientId(v ?? ''))
    void getMeta<string>(QUOTE_META.finnhubKey).then((v) => setFinnhubKey(v ?? ''))
    void getMeta<string>(QUOTE_META.yahooProxy).then((v) => setYahooProxy(v ?? ''))
  }, [])

  async function saveFinnhubKey() {
    const key = finnhubKey.trim()
    await setMeta(QUOTE_META.finnhubKey, key || undefined)
    toast(key ? 'Clave guardada' : 'Clave borrada')
    if (key) void quotes.refresh()
  }

  async function saveClientId() {
    await setMeta(META.clientId, clientId.trim() || undefined)
    await s.refreshConfig()
    toast(clientId.trim() ? 'ID de cliente guardado' : 'ID de cliente borrado')
  }

  async function saveYahooProxy() {
    const raw = yahooProxy.trim()
    const url = raw ? normalizeProxyUrl(raw) : undefined
    if (raw && !url) {
      toast('La dirección debe empezar por https:// (p. ej. https://buho-yahoo.tu-usuario.workers.dev).')
      return
    }
    await setMeta(QUOTE_META.yahooProxy, url)
    setYahooProxy(url ?? '')
    toast(url ? 'Proxy de Yahoo guardado' : 'Proxy de Yahoo borrado')
    if (url) void quotes.refresh()
  }

  async function checkYahooProxy() {
    setTesting(true)
    try {
      toast((await testYahooProxy(yahooProxy)).message)
    } finally {
      setTesting(false)
    }
  }

  async function download() {
    const snap = await exportSnapshot()
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `buho-cartera-${snap.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importFile(file: File) {
    try {
      const snap = parseSnapshot(await file.text())
      await mergeIntoLocal(snap)
      toast(`Copia importada: ${snap.movements.filter((m) => !m.deleted).length} movimientos`)
      if (s.status === 'ok') void s.syncNow()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar la copia.')
    }
  }

  async function wipe() {
    const msg =
      s.status === 'off'
        ? 'Se borrarán todos los datos de este dispositivo y no tienes Drive conectado. Descarga antes una copia si la necesitas. ¿Borrar?'
        : 'Se borrarán los datos de este dispositivo. La copia de Google Drive no se toca. ¿Borrar?'
    if (!confirm(msg)) return
    await s.disconnect()
    await wipeLocalData()
    await s.refreshConfig()
    toast('Datos de este dispositivo borrados')
  }

  const connected = s.status !== 'off'

  return (
    <>
      <div className="screen-head">
        <h1>Ajustes</h1>
      </div>

      <section className="settings-group" aria-labelledby="drive-h">
        <h2 id="drive-h">Google Drive</h2>
        <p>
          Buho guarda tus datos en este dispositivo. Si conectas Google Drive, también guarda un archivo
          llamado <strong>buho-cartera.json</strong> en tu Drive para tener copia y usar la app en varios
          dispositivos. Buho solo puede ver los archivos que crea él mismo, nunca el resto de tu Drive.
        </p>
        {connected && (
          <p>
            {s.email ? (
              <>
                Conectado como <strong>{s.email}</strong>.
              </>
            ) : (
              'Conectado.'
            )}{' '}
            {s.lastSyncAt ? `Última sincronización: ${timeFmt.format(new Date(s.lastSyncAt))}.` : ''}
          </p>
        )}
        {s.error && <p className="error-text">{s.error}</p>}
        <div className="actions">
          {s.status === 'off' && (
            <button className="btn primary" onClick={s.connect} disabled={!s.hasClientId}>
              Conectar Google Drive
            </button>
          )}
          {s.status === 'needs-login' && (
            <button className="btn primary" onClick={s.connect}>
              Reconectar y sincronizar
            </button>
          )}
          {(s.status === 'ok' || s.status === 'error' || s.status === 'syncing') && (
            <button className="btn primary" onClick={s.syncNow} disabled={s.status === 'syncing'}>
              {s.status === 'syncing' ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
          )}
          {connected && (
            <button className="btn" onClick={s.disconnect}>
              Desconectar
            </button>
          )}
        </div>
        {!s.hasClientId && (
          <p>Para conectar Drive hace falta el ID de cliente de Google de esta instalación. Mira el README del proyecto.</p>
        )}
        <details>
          <summary className="small muted">Configuración avanzada</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <label className="field">
              <span>ID de cliente OAuth de Google</span>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={envClientId || '1234567890-abc.apps.googleusercontent.com'}
                spellCheck={false}
              />
              <small>
                {envClientId
                  ? 'Déjalo vacío para usar el que viene con la app.'
                  : 'Solo necesario si alojas tu propia copia de Buho.'}
              </small>
            </label>
            <div className="actions">
              <button className="btn small" onClick={saveClientId}>
                Guardar ID de cliente
              </button>
            </div>
          </div>
        </details>
      </section>

      <section className="settings-group" aria-labelledby="base-h">
        <h2 id="base-h">Moneda principal</h2>
        <p>
          Es la que verás como principal en Seguimiento. La otra (euros o dólares) aparece debajo, más pequeña. La
          Cartera y los cálculos fiscales siguen siempre en euros.
        </p>
        <div className="segmented" role="radiogroup" aria-label="Moneda principal">
          {(
            [
              ['EUR', 'Euros (€)'],
              ['USD', 'Dólares ($)'],
            ] as const
          ).map(([code, label]) => (
            <label key={code}>
              <input
                type="radio"
                name="base-currency"
                value={code}
                checked={quotes.baseCurrency === code}
                onChange={() => void setMeta(QUOTE_META.baseCurrency, code)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-group" aria-labelledby="quotes-h">
        <h2 id="quotes-h">Cotizaciones</h2>
        <p>
          Buho pide los precios a Finnhub con tu propia clave gratuita, y los tipos de cambio al BCE (sin clave). La clave
          se guarda solo en este dispositivo y no se sube a Drive. Consíguela en finnhub.io, en «API Key».
        </p>
        <p>
          El plan gratuito de Finnhub solo cubre valores de EE. UU. Para BME, Xetra, fondos y bonos, escribe un precio
          manual en cada activo.
        </p>
        <label className="field">
          <span>Clave de Finnhub</span>
          <input
            type="password"
            value={finnhubKey}
            onChange={(e) => setFinnhubKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="actions">
          <button className="btn" onClick={saveFinnhubKey}>
            Guardar clave
          </button>
          <button className="btn" onClick={() => void quotes.refresh()} disabled={quotes.refreshing}>
            {quotes.refreshing ? 'Actualizando…' : 'Actualizar ahora'}
          </button>
        </div>
        <details open={!!yahooProxy}>
          <summary className="small muted">Yahoo Finance (para BME, Xetra y el resto de valores europeos)</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <p className="small muted">
              Yahoo no deja que una web lo consulte directamente, así que hace falta un pequeño proxy tuyo y gratuito en
              Cloudflare. Los pasos están en <strong>docs/YAHOO.md</strong> del proyecto. El proxy solo ve los tickers que
              consultas, nunca tus movimientos. Se usa para lo que Finnhub no cubre, y también para buscar valores.
            </p>
            <label className="field">
              <span>Dirección del proxy</span>
              <input
                value={yahooProxy}
                onChange={(e) => setYahooProxy(e.target.value)}
                placeholder="https://buho-yahoo.tu-usuario.workers.dev"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <div className="actions">
              <button className="btn" onClick={saveYahooProxy}>
                Guardar dirección
              </button>
              <button className="btn" onClick={checkYahooProxy} disabled={testing || yahooProxy.trim() === ''}>
                {testing ? 'Probando…' : 'Probar'}
              </button>
            </div>
          </div>
        </details>
        {quotes.lastReport && (quotes.lastReport.failed.length > 0 || quotes.lastReport.fxError) && (
          <ul className="error-text">
            {quotes.lastReport.failed.map((f) => (
              <li key={f.assetName}>
                {f.assetName}: {f.message}
              </li>
            ))}
            {quotes.lastReport.fxError && <li>{quotes.lastReport.fxError}</li>}
          </ul>
        )}
      </section>

      <section className="settings-group" aria-labelledby="backup-h">
        <h2 id="backup-h">Copias de seguridad</h2>
        <p>
          Descarga todos tus datos en un archivo, o importa uno. Al importar, los datos se combinan con los que ya
          tienes: no se pierde nada.
        </p>
        <div className="actions">
          <button className="btn" onClick={download}>
            Descargar copia
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Importar copia
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </section>

      <section className="settings-group" aria-labelledby="danger-h">
        <h2 id="danger-h">Este dispositivo</h2>
        <p>Borra los datos guardados en este navegador. Útil si vas a dejar de usar este dispositivo.</p>
        <div className="actions">
          <button className="btn danger" onClick={wipe}>
            Borrar datos de este dispositivo
          </button>
        </div>
      </section>

      <p className="small muted" style={{ marginTop: 24 }}>
        Buho {__APP_VERSION__}. Sin servidores: tus datos solo están en tus dispositivos y en tu Google Drive.
      </p>
    </>
  )
}
