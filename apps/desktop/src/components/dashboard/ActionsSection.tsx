import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSettingsStore } from '../../store/settingsStore'
import { useAuthStore } from '../../store/authStore'
import { useScanStream, loadLastScan, type LastScanResult, type AutoReadSuggestionItem } from '../../services/scanService'
import { ProposalCard } from './ProposalCard'
import { ScanRocketProgressBar } from './ScanRocketProgressBar'
import AutoReadModal from './AutoReadModal'
import TaskModal from './TaskModal'
import type { ScanProposalData, Proposal } from '@houston/shared-types'
import type { ScanSummary } from '@houston/shared-types'
import logoIcon from '../img/logo.webp'
import {
  fetchProposals,
  batchMarkRead,
  PROPOSAL_CREATED_EVENT,
  PROPOSALS_QUERY_KEY,
} from '../../services/proposalsApi'

const PROPOSALS_PER_PAGE = 10

function formatScanCompletedAt(completedAt: string): string {
  const date = new Date(completedAt)
  const minutes = date.getMinutes().toString().padStart(2, '0')

  return `${date.getHours()}:${minutes} ${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}

function createdAtTimestamp(proposal: ScanProposalData | Proposal): number {
  if (!('createdAt' in proposal) || !proposal.createdAt) return 0
  const timestamp = new Date(proposal.createdAt).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function isManualProposal(proposal: ScanProposalData | Proposal): boolean {
  return 'scanRunId' in proposal && proposal.scanRunId === null
}

const SOURCE_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  slack: 'Slack',
  calendar: 'Kalendář',
  jira: 'Jira',
  clockify: 'Clockify',
}

const REJECTION_LABELS: Record<string, string> = {
  missing_source: 'zdroj nenalezen',
  not_addressed: 'neadresováno uživateli',
  invalid_client: 'neplatný klient',
  old_message_unverified: 'stará neověřená zpráva',
  old_message_resolved: 'již vyřešeno',
}

function countDetails(counts: Record<string, number> | undefined, labels: Record<string, string>): string {
  if (!counts) return ''
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${labels[key] ?? key}: ${count}`)
    .join(' · ')
}

function ScanResultSummary({ summary, completedAt }: { summary: ScanSummary; completedAt: string }) {
  const proposalSources = countDetails(summary.proposalCountsBySource, SOURCE_LABELS)
  const inputSources = countDetails(
    Object.fromEntries(
      Object.entries(summary.sources).filter(([source]) => source === 'gmail' || source === 'slack' || source === 'calendar'),
    ),
    SOURCE_LABELS,
  )
  const rejectedReasons = countDetails(summary.relevanceRejected, REJECTION_LABELS)
  const sourceErrors = Object.entries(summary.sourceErrors ?? {})

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm" data-testid="scan-result-summary">
      <p className="text-gray-400">Poslední scan: {formatScanCompletedAt(completedAt)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <div><dt className="text-xs text-gray-500">Klasifikováno</dt><dd className="font-semibold text-gray-200">{summary.totalItems}</dd></div>
        <div><dt className="text-xs text-gray-500">Vytvořeno</dt><dd className="font-semibold text-emerald-300">{summary.proposalCount}</dd></div>
        <div><dt className="text-xs text-gray-500">Duplicity / sloučeno</dt><dd className="font-semibold text-gray-200">{summary.deduplicatedCount ?? '–'}</dd></div>
        <div><dt className="text-xs text-gray-500">Odfiltrováno</dt><dd className="font-semibold text-gray-200">{summary.relevanceFilteredCount ?? '–'}</dd></div>
      </dl>
      <div className="mt-3 space-y-1 text-xs text-gray-400">
        {proposalSources && <p><span className="text-gray-500">Vytvořeno podle zdroje:</span> {proposalSources}</p>}
        {inputSources && <p><span className="text-gray-500">Načtené položky:</span> {inputSources}</p>}
        <p><span className="text-gray-500">Priority:</span> Tier 1: {summary.tierCounts[1] ?? 0} · Tier 2: {summary.tierCounts[2] ?? 0}</p>
        {rejectedReasons && <p><span className="text-gray-500">Důvody filtrace:</span> {rejectedReasons}</p>}
        {sourceErrors.map(([source, error]) => (
          <p key={source} className="text-red-300"><span className="text-red-400">{SOURCE_LABELS[source] ?? source}:</span> {error}</p>
        ))}
      </div>
    </div>
  )
}

export default function ActionsSection() {
  const { scanState, start, stop, clearAutoReadSuggestions, isRestoring } = useScanStream()
  const { language } = useSettingsStore()
  const accessToken = useAuthStore((state) => state.accessToken)
  const userId = useAuthStore((state) => state.user?.id)
  const queryClient = useQueryClient()
  const proposalsQueryKey = [...PROPOSALS_QUERY_KEY, userId] as const
  const { state, phase, message, logs, proposals, autoReadSuggestions, summary, errorMessage } = scanState

  // Deklarace isRunning, isIdle hned po získání state
  const isRunning = state === 'running'
  const isIdle = state === 'idle'

  // Last persisted scan result – shown when idle
  const [lastScan, setLastScan] = useState<LastScanResult | null>(null)
  const {
    data: apiProposals = [],
    isLoading: isLoadingApi,
    isError: isApiError,
  } = useQuery({
    queryKey: proposalsQueryKey,
    queryFn: fetchProposals,
    enabled: Boolean(accessToken && userId),
  })

  const [showTaskModal, setShowTaskModal] = useState(false)

  // Auto-read modal state
  const [showAutoReadModal, setShowAutoReadModal] = useState(false)
  const [autoReadLoading, setAutoReadLoading] = useState(false)
  const [autoReadError, setAutoReadError] = useState<string | null>(null)
  const [expandedProposals, setExpandedProposals] = useState<Record<string, boolean>>({})
  const [proposalPage, setProposalPage] = useState(1)

  useEffect(() => {
    setLastScan(loadLastScan())
  }, [])

  useEffect(() => {
    const onProposalCreated = (event: Event) => {
      const proposal = (event as CustomEvent<Proposal>).detail
      if (!proposal?.id) return
      queryClient.setQueryData<Proposal[]>(proposalsQueryKey, (previous = []) =>
        previous.some((item) => item.id === proposal.id) ? previous : [proposal, ...previous],
      )
      setProposalPage(1)
    }
    window.addEventListener(PROPOSAL_CREATED_EVENT, onProposalCreated)
    return () => window.removeEventListener(PROPOSAL_CREATED_EVENT, onProposalCreated)
  }, [queryClient, userId])

  // After a scan completes, reload persisted result so it shows on next idle
  useEffect(() => {
    if (state === 'completed') {
      setLastScan(loadLastScan())
      void queryClient.invalidateQueries({ queryKey: PROPOSALS_QUERY_KEY })
    }
  }, [state, queryClient])

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
  const pendingProposals: (ScanProposalData | Proposal)[] = (() => {
    const currentScanProposalIds = new Set(proposals.map((proposal) => proposal.id))
    let base: (ScanProposalData | Proposal)[]
    if (isIdle) {
      const scanProposals = lastScan?.proposals ?? []
      if (scanProposals.length > 0) {
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
        base = apiProposals.length > 0 ? apiProposals : scanProposals
      }
    } else {
      const proposalIds = new Set(proposals.map((proposal) => proposal.id))
      base = [...proposals, ...apiProposals.filter((proposal) => !proposalIds.has(proposal.id))]
    }
    return [...base]
      .sort((a, b) => {
        const currentScanOrder = Number(currentScanProposalIds.has(b.id)) - Number(currentScanProposalIds.has(a.id))
        const manualOrder = Number(isManualProposal(b)) - Number(isManualProposal(a))
        return currentScanOrder || manualOrder || a.tier - b.tier || createdAtTimestamp(b) - createdAtTimestamp(a)
      })
      // Older locally cached scan results have no status; treat them as PENDING.
      .filter((proposal) => (proposal.status ?? 'PENDING') === 'PENDING')
  })()

  const proposalPageCount = Math.max(1, Math.ceil(pendingProposals.length / PROPOSALS_PER_PAGE))
  const visibleProposals = pendingProposals.slice(
    (proposalPage - 1) * PROPOSALS_PER_PAGE,
    proposalPage * PROPOSALS_PER_PAGE,
  )

  const visibleSummary = state === 'completed' ? summary : null
  const visibleProposalIds = visibleProposals.map((proposal) => proposal.id).join('\n')

  useEffect(() => {
    setProposalPage((currentPage) => Math.min(currentPage, proposalPageCount))
  }, [proposalPageCount])

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
    queryClient.setQueryData<Proposal[]>(proposalsQueryKey, (previous = []) =>
      previous.map((proposal) =>
        proposal.id === id ? { ...proposal, status: status as Proposal['status'] } : proposal,
      ),
    )
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
          <ScanResultSummary summary={visibleSummary} completedAt={lastScan.completedAt} />
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
        {isLoadingApi && isIdle ? (
          <div className="text-center text-gray-400 py-8">Načítám návrhy…</div>
        ) : isApiError && visibleProposals.length === 0 ? (
          <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-red-300 text-sm">
            Návrhy se nepodařilo načíst. Zkontroluj přihlášení nebo dostupnost backendu.
          </div>
        ) : visibleProposals.length > 0 && (
          <>
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
            {proposalPageCount > 1 && (
              <nav aria-label="Stránkování návrhů" className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setProposalPage((page) => Math.max(1, page - 1))}
                  disabled={proposalPage === 1}
                  className="button-action local small disabled:opacity-40"
                >
                  Předchozí
                </button>
                <span className="text-xs text-gray-400">
                  Stránka {proposalPage} z {proposalPageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setProposalPage((page) => Math.min(proposalPageCount, page + 1))}
                  disabled={proposalPage === proposalPageCount}
                  className="button-action local small disabled:opacity-40"
                >
                  Další
                </button>
              </nav>
            )}
          </>
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

