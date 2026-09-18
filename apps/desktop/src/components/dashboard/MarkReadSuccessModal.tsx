import { useEffect } from 'react'
import { Link } from 'react-router-dom'

type MarkReadSuccessModalProps = {
  source: 'gmail' | 'slack'
  savedSeconds: number
  onClose: () => void
}

function formatSeconds(seconds: number): string {
  return `${seconds} ${seconds === 1 ? 'sekundu' : seconds < 5 ? 'sekundy' : 'sekund'}`
}

export function MarkReadSuccessModal({ source, savedSeconds, onClose }: MarkReadSuccessModalProps) {
  const sourceLabel = source === 'gmail' ? 'Gmailu' : 'Slacku'

  useEffect(() => {
    const closeTimeout = window.setTimeout(onClose, 10_000)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(closeTimeout)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-labelledby="mark-read-success-title"
        aria-modal="true"
        className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 p-5 shadow-xl"
        onClick={onClose}
        role="dialog"
      >
        <div>
          <h2 id="mark-read-success-title" className="text-base font-bold text-white">
            Hotovo. Co se stalo?
          </h2>
        </div>
        <div className="mt-4 space-y-3 text-sm text-gray-300" role="status">
          <p>Zpráva v původním zdroji ({sourceLabel}) byla označena jako přečtená.</p>
          <p>Proposal byl označený jako přečtený.</p>
          <p className="flex items-center gap-2 text-emerald-400">
            Ušetřeno
            <img src="/img/ico-savings.webp" alt="" className="h-5 w-5" />
            <strong>{formatSeconds(savedSeconds)}</strong>.
          </p>
          <p className="pt-1 text-xs text-gray-500">
            Úsporu za přečtenou zprávu lze upravit na stránce{' '}
            <Link className="text-gray-400 underline hover:text-gray-200" to="/settings">
              Nastavení
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

type WorklogSuccessModalProps = {
  savedSeconds: number
  onClose: () => void
}

export function WorklogSuccessModal({ savedSeconds, onClose }: WorklogSuccessModalProps) {
  useEffect(() => {
    const closeTimeout = window.setTimeout(onClose, 10_000)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(closeTimeout)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-labelledby="worklog-success-title"
        aria-modal="true"
        className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 p-5 shadow-xl"
        onClick={onClose}
        role="dialog"
      >
        <h2 id="worklog-success-title" className="text-base font-bold text-white">
          Hotovo. Co se stalo?
        </h2>
        <div className="mt-4 space-y-3 text-sm text-gray-300" role="status">
          <p>Výkaz práce byl uložen.</p>
          <p className="flex items-center gap-2 text-emerald-400">
            Ušetřeno
            <img src="/img/ico-savings.webp" alt="" className="h-5 w-5" />
            <strong>{formatSeconds(savedSeconds)}</strong>.
          </p>
          <p className="pt-1 text-xs text-gray-500">
            Úsporu za výkaz práce lze upravit na stránce{' '}
            <Link className="text-gray-400 underline hover:text-gray-200" to="/settings">
              Nastavení
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}