import { useEffect, useState } from 'react'
import type { AutoReadSuggestionItem } from '../../services/scanService'

interface AutoReadModalProps {
  items: AutoReadSuggestionItem[]
  onConfirm: (selectedMessageIds: string[]) => void
  onCancel: () => void
  isLoading: boolean
}

function formatReceivedAt(iso: string): string {
  try {
    const d = new Date(iso)
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${day}. ${month}. ${hours}:${minutes}`
  } catch {
    return iso
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

export default function AutoReadModal({ items, onConfirm, onCancel, isLoading }: AutoReadModalProps) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(items.map((i) => i.messageId)),
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isLoading) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isLoading, onCancel])

  function toggle(messageId: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  const selectedCount = checkedIds.size

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-gray-900 rounded-lg shadow-lg p-6 min-w-[400px] max-w-[560px] w-full max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-lg font-bold text-yellow-400">Označit jako přečtené</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-yellow-400 text-xl font-bold">×</button>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Tyto e-maily scan vyhodnotil jako neprioritní. Odškrtni ty, které chceš přeskočit.
        </p>

        <div className="overflow-y-auto flex-1 divide-y divide-gray-700">
          {items.map((item) => (
            <label
              key={item.messageId}
              className="flex items-start gap-3 py-2 cursor-pointer hover:bg-gray-800 px-1 rounded"
            >
              <input
                type="checkbox"
                checked={checkedIds.has(item.messageId)}
                onChange={() => toggle(item.messageId)}
                className="mt-1 accent-yellow-400 shrink-0"
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-100 truncate">
                  {truncate(item.subject || '(bez předmětu)', 60)}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {truncate(item.from, 50)}
                  <span className="ml-2 text-gray-500">{formatReceivedAt(item.receivedAt)}</span>
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-gray-700">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 rounded text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Zrušit
          </button>
          <button
            onClick={() => onConfirm(Array.from(checkedIds))}
            disabled={isLoading || selectedCount === 0}
            className="px-4 py-2 rounded text-sm font-semibold bg-yellow-500 hover:bg-yellow-400 text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Označuji…' : `Potvrdit (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  )
}
