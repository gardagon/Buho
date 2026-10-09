import { useEffect } from 'react'

/** ¿El elemento (o algún padre) se desplaza en horizontal? Ahí el gesto es para desplazarse, no para cambiar de pestaña. */
function scrollsHorizontally(el: Element | null): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const o = getComputedStyle(n).overflowX
    if ((o === 'auto' || o === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true
  }
  return false
}

const MIN_DISTANCE = 70 // px
const MAX_TIME = 700 // ms

/**
 * Deslizar el dedo a los lados cambia de pestaña: a la izquierda va a la
 * siguiente y a la derecha, a la anterior. Solo con el dedo (no con el ratón),
 * no actúa con una ventana abierta ni sobre campos o tablas que se desplazan, y
 * pide un gesto claramente horizontal para no estorbar al desplazamiento vertical.
 */
export function useSwipeNav(order: readonly string[], current: string, go: (id: string) => void) {
  useEffect(() => {
    let sx = 0
    let sy = 0
    let t0 = 0
    let tracking = false

    const start = (e: TouchEvent) => {
      tracking = false
      if (e.touches.length !== 1 || document.querySelector('dialog[open]')) return
      const target = e.target as Element
      if (target.closest('input, textarea, select, [data-no-swipe]') || scrollsHorizontally(target)) return
      tracking = true
      sx = e.touches[0].clientX
      sy = e.touches[0].clientY
      t0 = Date.now()
    }
    const end = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t.clientX - sx
      const dy = t.clientY - sy
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - t0 > MAX_TIME) return
      const next = order[order.indexOf(current) + (dx < 0 ? 1 : -1)]
      if (next) go(next)
    }
    const cancel = () => {
      tracking = false
    }

    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchend', end, { passive: true })
    document.addEventListener('touchcancel', cancel, { passive: true })
    return () => {
      document.removeEventListener('touchstart', start)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', cancel)
    }
  }, [order, current, go])
}
