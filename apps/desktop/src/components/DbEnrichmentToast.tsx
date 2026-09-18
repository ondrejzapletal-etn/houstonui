import { useEffect } from 'react'
import { useDbEnrichmentStore } from '../store/dbEnrichmentStore'

export default function DbEnrichmentToast() {
  const notifications = useDbEnrichmentStore((s) => s.notifications)
  const dismiss = useDbEnrichmentStore((s) => s.dismiss)

  useEffect(() => {
    notifications.forEach((n) => {
      const timer = setTimeout(() => dismiss(n.id), 5000)
      return () => clearTimeout(timer)
    })
  }, [notifications, dismiss])

  if (notifications.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {notifications.map((n) => (
        <div key={n.id} className="pointer-events-auto flex items-center gap-3 rounded-xl border border-purple-600 bg-purple-950/95 px-4 py-3 shadow-xl backdrop-blur-sm max-w-sm">
          <img src="/img/ico-idea.webp" alt="" className="w-6 h-6 shrink-0" />
          <p className="flex-1 text-sm text-purple-100">{n.message}</p>
          <button onClick={() => dismiss(n.id)} className="shrink-0 text-purple-400 hover:text-purple-100 focus:outline-none" aria-label="Zavřít">✕</button>
        </div>
      ))}
    </div>
  )
}
