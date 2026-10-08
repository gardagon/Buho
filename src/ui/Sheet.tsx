import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
  onSubmit: () => void
  /** Guardando: no se puede cerrar ni editar hasta que termine. */
  busy?: boolean
}

/** Hoja modal: sube desde abajo en el móvil, centrada en pantallas grandes. */
export function Sheet({ title, onClose, children, footer, onSubmit, busy = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [slow, setSlow] = useState(false)

  // Si guardar tarda, se explica por qué puede ser y qué hacer.
  useEffect(() => {
    setSlow(false)
    if (!busy) return
    const t = setTimeout(() => setSlow(true), 3000)
    return () => clearTimeout(t)
  }, [busy])

  useEffect(() => {
    const dlg = ref.current
    if (dlg && !dlg.open) dlg.showModal()
    return () => dlg?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(e) => {
        if (!busy && e.target === ref.current) onClose()
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) onSubmit()
        }}
        noValidate
        aria-busy={busy}
      >
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost small" onClick={onClose} disabled={busy}>
            Cerrar
          </button>
        </div>
        <div className="sheet-body" inert={busy}>
          {children}
        </div>
        {busy && slow && (
          <p className="busy-note small muted" role="status">
            Está tardando más de lo normal. Si tienes Buho abierto en otra pestaña o en la app instalada, ciérrala y
            este guardado terminará enseguida.
          </p>
        )}
        <div className="sheet-foot">{footer}</div>
      </form>
    </dialog>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
