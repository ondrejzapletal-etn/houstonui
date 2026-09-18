import { useEffect } from 'react'
import TaskSection from './TaskSection'

export default function TaskModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-sm transition-colors"
          aria-label="Zavřít"
        >×</button>
        <div className="max-h-[85vh] overflow-y-auto rounded-xl">
          <TaskSection />
        </div>
      </div>
    </div>
  )
}
