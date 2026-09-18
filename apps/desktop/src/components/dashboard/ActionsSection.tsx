import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSettingsStore } from '../../store/settingsStore'
import { useScanStream, loadLastScan, type LastScanResult, type AutoReadSuggestionItem } from '../../services/scanService'
import { ProposalCard } from './ProposalCard'
import { ScanRocketProgressBar } from './ScanRocketProgressBar'
import AutoReadModal from './AutoReadModal'
import TaskModal from './TaskModal'
import type { ScanProposalData, Proposal } from '@houston/shared-types'
import logoIcon from '../img/logo.webp'
import { fetchProposals, batchMarkRead } from '../../services/proposalsApi'

function formatScanCompletedAt(completedAt: string): string {
  const date = new Date(completedAt)
  const minutes = date.getMinutes().toString().padStart(2, '0')

  return `${date.getHours()}:${minutes} ${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}

export default function ActionsSection() {
  const { scanState, start, stop, clearAutoReadSuggestions, isRestoring } = useScanStream()
  const { language } = useSettingsStore()
  const queryClient = useQueryClient()
  const { state, phase, message, logs, proposals, autoReadSuggestions, summary, errorMessage } = scanState

  // Deklarace isRunning, isIdle hned po získání state
  const isRunning = state === 'running'
  const isIdle = state === 'idle'

  // Last persisted scan result – shown when idle
  const [lastScan, setLastScan] = useState<LastScanResult | null>(null)
  // Proposals from API (with status)
  const [apiProposals, setApiProposals] = useState<Proposal[] | null>(null)
  const [loadingApi, setLoadingApi] = useState(false)

  const [showTaskModal, setShowTaskModal] = useState(false)

  // Auto-read modal state
  const [showAutoReadModal, setShowAutoReadModal] = useState(false)
  const [autoReadLoading, setAutoReadLoading] = useState(false)
  const [autoReadError, setAutoReadError] = useState<string | null>(null)
  const [expandedProposals, setExpandedProposals] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setLastScan(loadLastScan())
  }, [])

  // On idle, load proposals from API (with status)
  useEffect(() => {
    if (isIdle) {
      setLoadingApi(true)
      fetchProposals()
        .then((data) => {
          console.log('API proposals response', data)
          setApiProposals(data)
        })
        .catch(() => setApiProposals(null))
        .finally(() => setLoadingApi(false))
    }
  }, [isIdle])

  // After a scan completes, reload persisted result so it shows on next idle
  useEffect(() => {
    if (state === 'completed') {
      setLastScan(loadLastScan())
    }
  }, [state])

  // Auto-read suggestions: live during/after scan, from localStorage when idle
  const activeAutoReadSuggestions: AutoReadSuggestionItem[] =
    isIdle ? (lastScan?.autoReadSuggestions ?? []) : autoReadSuggestions

  async function handleAutoReadConfirm(selectedIds: string[]) {
    if (selectedIds.length === 0) {
      setShowAutoReadModal(false)
      return
    }
    setAutoReadLoading(true)
    setAutoReadError(null)
    try {
      await batchMarkRead(selectedIds)
      const selectedIdSet = new Set(selectedIds)
      const saved = loadLastScan()
      if (saved) {
        try {
          localStorage.setItem(
            'houston_last_scan',
            JSON.stringify({
              ...saved,
              autoReadSuggestions: saved.autoReadSuggestions.filter(
                (suggestion) => !selectedIdSet.has(suggestion.messageId),
              ),
            }),
          )
        } catch { /* storage full */ }
      }
      setLastScan((prev) => prev ? {
        ...prev,
        autoReadSuggestions: prev.autoReadSuggestions.filter(
          (suggestion) => !selectedIdSet.has(suggestion.messageId),
        ),
      } : prev)
      try {
        clearAutoReadSuggestions(selectedIds)
      } catch { /* noop if not available */ }
      setShowAutoReadModal(false)
      void queryClient.invalidateQueries({ queryKey: ['user-stats'] })
    } catch {
      setAutoReadError('Označení se nezdařilo. Zkus to znovu.')
    } finally {
      setAutoReadLoading(false)
    }
  }

  // Which proposals to show: live ones while running/completed, last scan when idle

  // Prefer API proposals (with status) when idle, otherwise use live proposals
  // When idle: use lastScan proposals (same set as right after scan) enriched with current status from API
  const visibleProposals: (ScanProposalData | Proposal)[] = (() => {
    let base: (ScanProposalData | Proposal)[]
    if (isIdle) {
      const scanProposals = lastScan?.proposals ?? []
      if (apiProposals && scanProposals.length > 0) {
        // Enrich last-scan proposals with up-to-date status from API (matched by id)
        // Keep all scan fields (originalMessage, detectedClient, projectKey, calendarEventId, etc.)
        // because the DB does not persist those — only overlay status.
        const apiMap = new Map(apiProposals.map((p) => [p.id, p]))
        const matchedScanProposals = scanProposals.flatMap((p) => {
          const api = apiMap.get(p.id)
          return api ? [{ ...p, status: api.status }] : []
        })
        const scanIds = new Set(scanProposals.map((p) => p.id))
        base = [
          ...matchedScanProposals,
          ...apiProposals.filter((p) => !scanIds.has(p.id)),
        ]
      } else {
        base = apiProposals ?? scanProposals
      }
    } else {
      base = proposals
    }
    return base
      .sort((a, b) => a.tier - b.tier)
      // Older locally cached scan results have no status; treat them as PENDING.
      .filter((proposal) => (proposal.status ?? 'PENDING') === 'PENDING')
      .slice(0, 10)
  })()

  const visibleSummary = state === 'completed' ? summary : null
  const visibleProposalIds = visibleProposals.map((proposal) => proposal.id).join('\n')

  function handleProposalStatusChange(id: string, status: ScanProposalData['status']) {
    setLastScan((previous) => {
      if (!previous || !status) return previous
      const next = {
        ...previous,
        proposals: previous.proposals.map((proposal) =>
          proposal.id === id ? { ...proposal, status } : proposal,
        ),
      }
      try {
        localStorage.setItem('houston_last_scan', JSON.stringify(next))
      } catch { /* storage unavailable */ }
      return next
    })
    setApiProposals((previous) => previous?.map((proposal) =>
      proposal.id === id ? { ...proposal, status: status as Proposal['status'] } : proposal,
    ) ?? previous)
  }

  useEffect(() => {
    const ids = visibleProposalIds === '' ? [] : visibleProposalIds.split('\n')
    setExpandedProposals((prev) => {
      if (ids.length === 0) return {}

      const hasKnownVisible = ids.some((id) => Object.prototype.hasOwnProperty.call(prev, id))
      const next: Record<string, boolean> = {}

      ids.forEach((id, index) => {
        if (Object.prototype.hasOwnProperty.call(prev, id)) {
          next[id] = prev[id]
        } else {
          next[id] = !hasKnownVisible && index === 0
        }
      })

      return next
    })
  }, [visibleProposalIds])

  return (
    <section aria-labelledby="actions-heading">
      <div className=" p-2 space-y-5">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h2
              id="actions-heading"
              className="text-lg font-bold uppercase tracking-wide"
            >
              Komunikace
            </h2>
            {isIdle && lastScan && (
              <p className="text-xs text-gray-500 mt-0.5">
                Poslední scan:{' '}
                {new Date(lastScan.completedAt).toLocaleString('cs-CZ', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </p>
            )}
          </div>

          {/* Running indicator */}
          {isRunning && (
            <div className="flex items-center gap-2 text-indigo-400 text-sm">
              <span className="animate-pulse">●</span>
              <span>Scanuji…</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTaskModal(true)}
              className="button-action local transition-colors"
            >
              Houston Task
            </button>
            {/* Scan button */}
            {!isRunning ? (
              <button
                onClick={() => start(language)}
                disabled={isRestoring}
                className="button-action local transition-colors"
              >
                <img src={logoIcon} alt="" aria-hidden="true" className="h-4 w-4 object-contain" /> {isRestoring ? 'Kontroluji scan…' : 'Spustit scan'}
              </button>
            ) : (
              <button
                onClick={stop}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
              >
                <span className="animate-pulse text-red-400">■</span> Zastavit
              </button>
            )}
          </div>
        </div>


        {/* Rocket progress bar – visible only while running */}
        {isRunning && (
          <>
            <ScanRocketProgressBar phase={phase} />
            {message && <p className="text-xs text-gray-400" role="status">{message}</p>}
          </>
        )}

        {/* Error */}
        {state === 'error' && (
          <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-red-300 text-sm">
            {errorMessage}
          </div>
        )}

        {/* Completion summary */}
        {visibleSummary && lastScan && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-gray-500 text-sm">
            Poslední scan: {formatScanCompletedAt(lastScan.completedAt)} |{' '}
            {visibleSummary.totalItems} položek klasifikováno |{' '}
            {visibleSummary.proposalCount} návrhů.
          </div>
        )}

        {/* Auto-read button */}
        {activeAutoReadSuggestions.length > 0 && (state === 'completed' || isIdle) && (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => { setAutoReadError(null); setShowAutoReadModal(true) }}
              className="button-action local transition-colors self-start"
            >
              Označit přečtené ({activeAutoReadSuggestions.length})
            </button>
            {autoReadError && (
              <p className="text-xs text-red-400">{autoReadError}</p>
            )}
          </div>
        )}

        {/* Houston Task modal */}
        {showTaskModal && <TaskModal onClose={() => setShowTaskModal(false)} />}

        {/* Auto-read confirm modal */}
        {showAutoReadModal && (
          <AutoReadModal
            items={activeAutoReadSuggestions}
            onConfirm={handleAutoReadConfirm}
            onCancel={() => setShowAutoReadModal(false)}
            isLoading={autoReadLoading}
          />
        )}

        {/* Log stream – visible during scan and after completion/error */}
        {(isRunning || state === 'completed' || state === 'error') && logs.length > 0 && (
          <div className="bg-gray-950 rounded-lg p-3 font-mono text-xs space-y-0.5 max-h-40 overflow-y-auto">
            {logs.map((line, i) => (
              <div key={i} className="text-gray-400">
                {line}
              </div>
            ))}
          </div>
        )}

        {/* Proposals */}
        {loadingApi && isIdle ? (
          <div className="text-center text-gray-400 py-8">Načítám návrhy…</div>
        ) : visibleProposals.length > 0 && (
          <div className="space-y-6">
            {visibleProposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                onStatusChange={(status) => handleProposalStatusChange(p.id, status)}
                isExpanded={expandedProposals[p.id] ?? false}
                onToggleExpand={() =>
                  setExpandedProposals((prev) => ({
                    ...prev,
                    [p.id]: !prev[p.id],
                  }))
                }
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {isIdle && visibleProposals.length === 0 && !lastScan && (
          <p className="text-sm text-gray-500 text-center py-4">
            Žádný scan ještě neproběhl. Klikni „Spustit scan".
          </p>
        )}
      </div>
    </section>
  )
}

