import { useEffect } from 'react'

/**
 * Zavolá `onEscape` při stisku Escape, dokud je hook aktivní.
 *
 * Modály v projektu si tento useEffect kopírují; nové komponenty ať použijí hook.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape, enabled])
}
