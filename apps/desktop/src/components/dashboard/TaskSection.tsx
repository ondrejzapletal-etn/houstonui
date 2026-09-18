import { useRef, useState } from 'react'
import { useTaskStream } from '../../services/taskService'
import { ProposalCard } from './ProposalCard'
import { useSettingsStore } from '../../store/settingsStore'

export default function TaskSection() {
  const { language } = useSettingsStore()
  const { taskState, start, reset } = useTaskStream()
  const [request, setRequest] = useState('')
  const [allowLiveData, setAllowLiveData] = useState(false)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isRunning = taskState.state === 'running'
  const hasResult = taskState.result !== null
  const visibleProposals = taskState.proposals.filter((p) => !removedIds.has(p.id))

  function handleSubmit() {
    if (!request.trim() || isRunning) return
    setRemovedIds(new Set())
    void start(request.trim(), language, allowLiveData)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleReset() {
    reset()
    setRequest('')
    setRemovedIds(new Set())
    textareaRef.current?.focus()
  }

  return (
    <section className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Houston Task</h2>
        {(hasResult || taskState.state === 'error') && (
          <button
            onClick={handleReset}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Nový dotaz
          </button>
        )}
      </div>

      {/* Empty idle state */}
      {taskState.state === 'idle' && !hasResult && request === '' && (
        <div className="text-xs text-gray-600">
          Popište, co potřebujete vědět nebo udělat. Houston sestaví kontext, prohledá grafy znalostí a navrhne akce.
        </div>
      )}

      {/* Input area – visible only when idle or error (no result yet) */}
      {!hasResult && taskState.state !== 'running' && (
        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={'Zeptejte se na cokoli, nebo zadejte příkaz k provedení:\nPříklady: “Shrň projekt X” · “Přidej klienta Contoso” · “Vytvoř úkol Bug v projektu PROJ”'}
            rows={3}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-sm text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowLiveData}
                onChange={(e) => setAllowLiveData(e.target.checked)}
                className="w-4 h-4 rounded accent-blue-500"
              />
              Načíst živá data ze zdrojů
            </label>
            <button
              onClick={handleSubmit}
              disabled={!request.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Spustit <span className="text-xs text-blue-300 ml-1">Enter</span>
            </button>
          </div>
        </div>
      )}

      {/* Progress logs */}
      {(isRunning || (taskState.logs.length > 0 && !hasResult)) && (
        <div className="space-y-1">
          {taskState.logs.map((log, i) => (
            <p key={i} className="text-xs text-gray-400 font-mono leading-relaxed">
              {log}
            </p>
          ))}
          {isRunning && (
            <p className="text-xs text-blue-400 font-mono animate-pulse">
              ⏳ Zpracovávám…
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {taskState.state === 'error' && taskState.errorMessage && (
        <div className="rounded-lg bg-red-950 border border-red-700 px-4 py-3 text-sm text-red-300">
          {taskState.errorMessage}
        </div>
      )}

      {/* Result */}
      {hasResult && (
        <div className="space-y-4">
          {/* Show the original request as a reminder */}
          {request && (
            <p className="text-xs text-gray-500 italic">
              Dotaz: {request}
            </p>
          )}

          {/* Markdown result – rendered as plain pre for v1 */}
          <div className="bg-gray-900 rounded-lg border border-gray-700 px-5 py-4 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap font-sans">
            {taskState.result}
          </div>

          {/* Proposals */}
          {visibleProposals.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-300">
                Navrhované akce ({visibleProposals.length})
              </h3>
              <div className="space-y-3">
                {visibleProposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    onRemove={() =>
                      setRemovedIds((prev) => new Set([...prev, proposal.id]))
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Progress logs under result (collapsed) */}
          {taskState.logs.length > 0 && (
            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer hover:text-gray-400 select-none">
                Log ({taskState.logs.length} položek)
              </summary>
              <div className="mt-2 space-y-0.5 font-mono">
                {taskState.logs.map((log, i) => (
                  <p key={i}>{log}</p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

    </section>
  )
}
