import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastMsg {
  text: string
  action?: { label: string; run: () => void }
}

const Ctx = createContext<(m: ToastMsg | string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback((m: ToastMsg | string) => {
    clearTimeout(timer.current)
    setMsg(typeof m === 'string' ? { text: m } : m)
    timer.current = setTimeout(() => setMsg(null), 4500)
  }, [])

  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite">
        {msg && (
          <div className="toast" role="status">
            {msg.text}
            {msg.action && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  msg.action!.run()
                  setMsg(null)
                }}
              >
                {msg.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
