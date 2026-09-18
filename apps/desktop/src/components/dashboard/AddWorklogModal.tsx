import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useJiraWorklogs } from '../../hooks/useJiraWorklogs'
import { useClockifyWorklogs } from '../../hooks/useClockifyWorklogs'
import { useAddWorklog } from '../../hooks/useAddWorklog'
import { useAddClockifyWorklog } from '../../hooks/useAddClockifyWorklog'
import { useUpdateWorklog } from '../../hooks/useUpdateWorklog'
import { useAuthStore } from '../../store/authStore'
import { findOrCreateProjectByJiraKey, deleteJiraWorklog } from '../../services/connectorsClient'
import { useDbEnrichmentStore } from '../../store/dbEnrichmentStore'
import { buildDbEnrichmentMessage } from '../../services/dbEnrichmentMessages'
import { useSettingsStore } from '../../store/settingsStore'
import { useCalendarLink, useSaveCalendarLink } from '../../hooks/useCalendarLink'
import { useKnowledgeTasks } from '../../hooks/useKnowledge'
import { useIssueSuggestion } from '../../hooks/useIssueSuggestion'
import {
  MONTHLY_WORKLOG_ISSUES_QUERY_KEY,
  useMonthlyWorklogIssues,
} from '../../hooks/useMonthlyWorklogIssues'
import { MONTHLY_ISSUE_WORKLOGS_QUERY_KEY } from '../../hooks/useWorklogsByIssue'
import { JIRA_WORKLOGS_QUERY_KEY } from '../../hooks/useJiraWorklogs'
import IssueSearchInput from '../IssueSearchInput'
import { fetchCalendarEvent } from '../../services/calendarClient'
import { createClient } from '../../services/projectsClient'
import { WorklogSuccessModal } from './MarkReadSuccessModal'

// ─── Time parsing ─────────────────────────────────────────────────────────────

/**
 * Parses a human-friendly time string into total seconds.
 *
 * Accepted formats:
 *   "1h 30m"  → 5400
 *   "90m"     → 5400
 *   "1.5h"    → 5400
 *   "3600"    → 3600  (plain number treated as seconds)
 *   "2h"      → 7200
 *
 * Returns null when the string cannot be parsed or the result is < 60.
 */
export function parseTimeInput(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null

  let seconds = 0
  let matched = false

  // Match "Xh Ym" or "Xh" or "Ym"
  const hm = s.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+)m)?$/)
  if (hm && (hm[1] !== undefined || hm[2] !== undefined)) {
    seconds =
      (hm[1] !== undefined ? Math.round(parseFloat(hm[1]) * 3600) : 0) +
      (hm[2] !== undefined ? parseInt(hm[2], 10) * 60 : 0)
    matched = true
  }

  // Match plain number (treat as seconds)
  if (!matched && /^\d+$/.test(s)) {
    seconds = parseInt(s, 10)
    matched = true
  }

  if (!matched || seconds < 60) return null
  return seconds
}

/**
 * Formats seconds as "Xh Ym" for display in the time input after successful submit.
 */
export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const JIRA_ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** ISO "YYYY-MM-DD" pre-filled date (optional, defaults to today) */
  defaultDate?: string
  /** Duration in seconds to prefill time input (optional) */
  defaultDurationSeconds?: number
  /** Google Calendar event ID — when set, fetches and saves the issue link */
  calendarEventId?: string
  /** Google Calendar recurring series ID for the event. Enables binding to persist
   *  across all occurrences of the same recurring meeting. */
  recurringEventId?: string
  /** Jira issue key to pre-fill (e.g. "PROJ-123") */
  defaultIssueKey?: string
  /** Email addresses providing context for client detection (attendees or email recipient).
   *  Used when no saved calendar binding exists. */
  contextEmails?: string[]
  onClose: () => void
  /** When set, the modal operates in edit mode for this worklog ID */
  editWorklogId?: string
  /** Issue key the worklog belongs to — pre-filled in edit mode */
  editIssueKey?: string
  /** Original comment to pre-fill in edit mode */
  editComment?: string
  /** Preferred default reporting target for this modal open */
  defaultTarget?: 'jira' | 'clockify'
}

// ─── Component ────────────────────────────────────────────────────────────────



export default function AddWorklogModal({ defaultDate, defaultDurationSeconds, calendarEventId, recurringEventId, defaultIssueKey, contextEmails, onClose, editWorklogId, editIssueKey, editComment, defaultTarget = 'jira' }: Props) {
  const isEditMode = !!editWorklogId
  const titleId = useId()
  const firstInputRef = useRef<HTMLInputElement>(null)

  const today = new Date().toISOString().substring(0, 10)
  const [issueKey, setIssueKey] = useState(isEditMode ? (editIssueKey ?? '') : (defaultIssueKey ?? ''))
  const [date, setDate] = useState(defaultDate ?? today)
  const [timeInput, setTimeInput] = useState(() =>
    defaultDurationSeconds ? formatSeconds(defaultDurationSeconds) : ''
  )
  const [target, setTarget] = useState<'jira' | 'clockify'>(defaultTarget)
  const [clockifyProjectId, setClockifyProjectId] = useState('')
  const [comment, setComment] = useState(isEditMode ? (editComment ?? '') : '')
  const [timeError, setTimeError] = useState<string | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  const [showWorklogSuccess, setShowWorklogSuccess] = useState(false)

  const addMutation = useAddWorklog()
  const addClockifyMutation = useAddClockifyWorklog()
  const updateMutation = useUpdateWorklog()
  // In edit mode, "move" (issue key changed) uses addMutation; same-key edit uses updateMutation
  const issueKeyChangedLive =
    isEditMode && issueKey.trim().toUpperCase() !== (editIssueKey ?? '').trim().toUpperCase()
  const activeMutation = target === 'clockify'
    ? addClockifyMutation
    : (isEditMode && !issueKeyChangedLive ? updateMutation : addMutation)
  const { isPending, isError, error, isSuccess, reset } = activeMutation
  const queryClient = useQueryClient()
  const recentJiraIssues = useSettingsStore((s) => s.recentJiraIssues)
  const addRecentJiraIssue = useSettingsStore((s) => s.addRecentJiraIssue)
  const timeSavingsSecondsPerWorklog = useSettingsStore((s) => s.timeSavingsSecondsPerWorklog)
  const [issueSummary, setIssueSummary] = useState<string | undefined>(undefined)

  const [selectedYear, selectedMonth] = useMemo(() => {
    const [y, m] = date.split('-').map(Number)
    return [y, m]
  }, [date])

  const { issues: monthlyIssues } = useMonthlyWorklogIssues({
    year: selectedYear,
    month: selectedMonth,
    enabled: true,
  })

  const clockifySuggestions = useMemo(() => {
    const clockifyItems = monthlyIssues.filter((item) => item.source === 'clockify')
    const seen = new Set<string>()
    return clockifyItems.filter((item) => {
      if (seen.has(item.reference)) return false
      seen.add(item.reference)
      return true
    }).slice(0, 8)
  }, [monthlyIssues])

  // Build issueKey → title map from Knowledge Graph tasks (already cached by dashboard)
  const { data: knowledgeTasks } = useKnowledgeTasks()
  const knowledgeSummaryMap = useMemo(() => {
    const map = new Map<string, string>()
    knowledgeTasks?.forEach((task) => {
      const keyFact = task.facts.find((f) => f.key === 'jiraIssueKey' || f.key === 'issueKey')
      if (keyFact && task.title) map.set(String(keyFact.value).toUpperCase(), task.title)
    })
    return map
  }, [knowledgeTasks])

  // Calendar-link: pre-fill issue key from saved link (falls back to recurring series binding)
  const { data: calendarLink } = useCalendarLink(calendarEventId, recurringEventId)
  const { mutate: saveCalendarLink } = useSaveCalendarLink(calendarEventId ?? '', recurringEventId)

  // Attendees captured from the calendar event fetch — used for client suggestion
  const [eventAttendees, setEventAttendees] = useState<string[]>([])
  const [addingClient, setAddingClient] = useState(false)

  // Prefill comment from calendar event summary and capture attendees
  useEffect(() => {
    if (!calendarEventId) return
    let mounted = true
    const accessToken = useAuthStore.getState().accessToken ?? ''
    ;(async () => {
      try {
        const ev = await fetchCalendarEvent(accessToken, calendarEventId)
        if (!mounted) return
        if (ev?.summary && !comment) setComment(ev.summary)
        if (ev?.attendees?.length) {
          setEventAttendees((ev.attendees as Array<{ email: string }>).map((a) => a.email))
        }
      } catch {
        // ignore
      }
    })()
    return () => {
      mounted = false
    }
  }, [calendarEventId])

  // Issue suggestion based on client from attendee/email context
  const suggestionEmails = contextEmails?.length ? contextEmails : eventAttendees
  // For calendar events: suggest only after the link lookup resolves to null (no saved binding).
  // For email/other context (no calendarEventId): suggest whenever contextEmails are provided.
  const shouldSuggest = !defaultIssueKey && (
    calendarEventId ? calendarLink === null : (suggestionEmails.length > 0)
  )
  const { data: suggestion, refetch: refetchSuggestion } = useIssueSuggestion(
    shouldSuggest ? suggestionEmails : undefined,
  )

  // Pre-fill issueKey once the calendar link loads (only if user hasn't typed yet)
  useEffect(() => {
    if (calendarLink?.issueKey && !issueKey) {
      setIssueKey(calendarLink.issueKey)
    }
  }, [calendarLink?.issueKey])

  // Auto-focus first input on mount
  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTimeError(null)

    const timeSpentSeconds = parseTimeInput(timeInput)
    if (timeSpentSeconds === null) {
      setTimeError('Zadej čas ve formátu "1h 30m", "90m" nebo "3600"')
      return
    }

    // Získat projektový ident z issueKey (část před '-')
    const trimmedKey = issueKey.trim().toUpperCase()

    if (target === 'clockify') {
      addClockifyMutation.mutate(
        {
          issueKey: JIRA_ISSUE_KEY_RE.test(trimmedKey) ? trimmedKey : undefined,
          projectId: clockifyProjectId.trim() || undefined,
          date,
          timeSpentSeconds,
          comment: comment.trim() || undefined,
        },
        {
          onSuccess: () => {
            try {
              const token = useAuthStore.getState().accessToken ?? null
              const key = ['user-stats', token]
              queryClient.setQueryData(key, (old: any) => {
                const prev = old ?? {}
                return {
                  ...prev,
                  worklogsCount: (prev.worklogsCount ?? 0) + 1,
                  worklogsSeconds: (prev.worklogsSeconds ?? 0) + timeSpentSeconds,
                }
              })
              queryClient.invalidateQueries({ queryKey: key })
            } catch {
              // ignore cache update failures
            }
            setShowWorklogSuccess(true)
          },
        },
      )
      return
    }

    if (!JIRA_ISSUE_KEY_RE.test(trimmedKey)) {
      setTimeError('Zadej platný Jira issue key, např. PROJ-123')
      return
    }

    const capturedSummary = issueSummary
    const projectIdent = trimmedKey.split('-')[0]
    const accessToken = useAuthStore.getState().accessToken ?? ''

    // Ověřit/založit projekt

    try {
      const resp = await findOrCreateProjectByJiraKey(accessToken, projectIdent)
      if (!resp.success) {
        setTimeError('Projekt se nepodařilo ověřit/založit: ' + (resp.error || 'Neznámá chyba'))
        return
      }
      if (resp.wasCreated) {
        const push = useDbEnrichmentStore.getState().push
        push({
          entityType: 'project',
          action: 'created',
          label: projectIdent,
          message: buildDbEnrichmentMessage('project', 'created', projectIdent),
        })
      }
    } catch (err: any) {
      setTimeError('Projekt se nepodařilo ověřit/založit: ' + (err?.message || 'Neznámá chyba'))
      return
    }

    if (isEditMode) {
      const issueKeyChanged = trimmedKey !== (editIssueKey ?? '').trim().toUpperCase()

      if (issueKeyChanged) {
        // Issue key changed: add worklog to new issue, then delete from old issue
        addMutation.mutate(
          {
            issueKey: trimmedKey,
            date,
            timeSpentSeconds,
            comment: comment.trim() || undefined,
          },
          {
            onSuccess: async () => {
              // Delete old worklog from the original issue
              try {
                const token = useAuthStore.getState().accessToken ?? ''
                await deleteJiraWorklog(token, editWorklogId!, editIssueKey!, defaultDurationSeconds)
              } catch (err: any) {
                setTimeError(
                  `Nový worklog byl vytvořen, ale původní (${editIssueKey}) se nepodařilo smazat: ${err?.message ?? 'Neznámá chyba'}. Smažte jej ručně v Jiře.`,
                )
                return
              }
              const [previousYear, previousMonth] = (defaultDate ?? date).split('-').map(Number)
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: JIRA_WORKLOGS_QUERY_KEY(previousYear, previousMonth) }),
                queryClient.invalidateQueries({
                  queryKey: MONTHLY_WORKLOG_ISSUES_QUERY_KEY(previousYear, previousMonth),
                }),
                queryClient.invalidateQueries({
                  queryKey: MONTHLY_ISSUE_WORKLOGS_QUERY_KEY(
                    previousYear,
                    previousMonth,
                    'jira',
                    editIssueKey!,
                  ),
                }),
              ])
              // Stats cache: net effect is count same, seconds adjusted by delta
              try {
                const token = useAuthStore.getState().accessToken ?? null
                const key = ['user-stats', token]
                queryClient.setQueryData(key, (old: any) => {
                  const prev = old ?? {}
                  const delta = timeSpentSeconds - (defaultDurationSeconds ?? 0)
                  return { ...prev, worklogsSeconds: (prev.worklogsSeconds ?? 0) + delta }
                })
                queryClient.invalidateQueries({ queryKey: key })
              } catch {
                // ignore
              }
              setIsClosing(true)
              setTimeout(onClose, 330)
            },
          },
        )
      } else {
        updateMutation.mutate(
          {
            worklogId: editWorklogId!,
            previousDate: defaultDate ?? date,
            body: {
              issueKey: trimmedKey,
              date,
              timeSpentSeconds,
              comment: comment.trim() || undefined,
              oldTimeSpentSeconds: defaultDurationSeconds,
            },
          },
          {
            onSuccess: () => {
              try {
                const token = useAuthStore.getState().accessToken ?? null
                const key = ['user-stats', token]
                queryClient.setQueryData(key, (old: any) => {
                  const prev = old ?? {}
                  const delta = timeSpentSeconds - (defaultDurationSeconds ?? 0)
                  return { ...prev, worklogsSeconds: (prev.worklogsSeconds ?? 0) + delta }
                })
                queryClient.invalidateQueries({ queryKey: key })
              } catch {
                // ignore cache update failures
              }
              setIsClosing(true)
              setTimeout(onClose, 330)
            },
          },
        )
      }
    } else {
      addMutation.mutate(
        {
          issueKey: trimmedKey,
          date,
          timeSpentSeconds,
          comment: comment.trim() || undefined,
        },
        {
          onSuccess: () => {
            // Update recent issue with summary captured at submit time
            addRecentJiraIssue(trimmedKey, capturedSummary)
            // Remember this issue for future calendar events
            if (calendarEventId) {
              saveCalendarLink({ issueKey: trimmedKey })
            }
            // Optimistically update user stats cache and invalidate to refetch
            try {
              const token = useAuthStore.getState().accessToken ?? null
              const key = ['user-stats', token]
              queryClient.setQueryData(key, (old: any) => {
                const prev = old ?? {}
                return {
                  ...prev,
                  worklogsCount: (prev.worklogsCount ?? 0) + 1,
                  worklogsSeconds: (prev.worklogsSeconds ?? 0) + timeSpentSeconds,
                }
              })
              queryClient.invalidateQueries({ queryKey: key })
            } catch {
              // ignore cache update failures
            }
            setShowWorklogSuccess(true)
          },
        },
      )
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Panel */}
      <div className={["w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl mx-4", isClosing ? "modal-animate-close" : ""].join(" ")}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 id={titleId} className="text-base font-semibold text-gray-100">
            {isEditMode ? 'Upravit výkaz' : 'Vykaž'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4" noValidate>
          {/* Issue key */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="issue-key" className="text-xs font-medium text-gray-400">
                Issue ID <span className="text-red-400">*</span>
              </label>
              <div className="inline-flex rounded-md border border-gray-700 bg-gray-800 p-0.5" aria-label="Cíl vykazování">
                <button
                  type="button"
                  onClick={() => setTarget('jira')}
                  className={[
                    'rounded px-2 py-0.5 text-xs transition-colors',
                    target === 'jira'
                      ? 'bg-yellow-400/10 text-yellow-300 border border-yellow-400'
                      : 'text-gray-400 border border-transparent hover:text-gray-200',
                  ].join(' ')}
                >
                  Jira
                </button>
                <button
                  type="button"
                  onClick={() => setTarget('clockify')}
                  className={[
                    'rounded px-2 py-0.5 text-xs transition-colors',
                    target === 'clockify'
                      ? 'bg-yellow-400/10 text-yellow-300 border border-yellow-400'
                      : 'text-gray-400 border border-transparent hover:text-gray-200',
                  ].join(' ')}
                >
                  Clockify
                </button>
              </div>
            </div>

            {/* Clockify suggested targets */}
            {clockifySuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1" aria-label="Navrhované položky z Clockify">
                {clockifySuggestions.map((item) => {
                  const mappedIssueKey = item.jiraIssueKey?.trim().toUpperCase()
                  const canUseForReport = !!mappedIssueKey && JIRA_ISSUE_KEY_RE.test(mappedIssueKey)
                  return (
                  <button
                    key={`clockify:${item.reference}:${item.title ?? ''}`}
                    type="button"
                    onClick={() => {
                      setTarget('clockify')
                      setIssueKey(mappedIssueKey ?? item.reference)
                      setClockifyProjectId(item.reference)
                      setIssueSummary(item.title)
                    }}
                    title={canUseForReport ? 'Předvyplnit pro vykázání' : 'Vykázat do Clockify'}
                    className={[
                      'relative group rounded px-2 py-0.5 text-xs border transition-colors',
                      target === 'clockify' && issueKey === (mappedIssueKey ?? item.reference)
                        ? 'border-yellow-400 bg-yellow-400/10 text-yellow-300'
                        : 'border-blue-700 bg-blue-900/20 text-blue-300 hover:border-blue-500 hover:text-blue-100',
                    ].join(' ')}
                  >
                    <span className="mr-1 text-[10px] uppercase text-blue-300">Clockify</span>
                    {mappedIssueKey ?? item.reference}
                    {item.title && (
                      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap rounded border border-gray-600 bg-gray-900 px-2 py-1 text-gray-200 opacity-0 transition-opacity group-hover:opacity-100 z-50">
                        {item.title}
                      </span>
                    )}
                  </button>
                  )
                })}
              </div>
            )}

            {/* Recent issues chips */}
            {recentJiraIssues.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1" aria-label="Nedávné issues">
                {recentJiraIssues.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setTarget('jira')
                      setIssueKey(item.key)
                      setClockifyProjectId('')
                      setIssueSummary(undefined)
                    }}
                    className={[
                      'relative group rounded px-2 py-0.5 text-xs border transition-colors',
                      target === 'jira' && issueKey === item.key
                        ? 'border-yellow-400 bg-yellow-400/10 text-yellow-300'
                        : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-200',
                    ].join(' ')}
                  >
                    {item.key}
                    {(knowledgeSummaryMap.get(item.key) ?? item.summary) && (
                      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap rounded border border-gray-600 bg-gray-900 px-2 py-1 text-gray-200 opacity-0 transition-opacity group-hover:opacity-100 z-50">
                        {knowledgeSummaryMap.get(item.key) ?? item.summary}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Client-based issue suggestions */}
            {suggestion && (suggestion.client || suggestion.unknownDomain) && (
              <div className="mb-1">
                {suggestion.client && (
                  <p className="text-xs text-gray-500 mb-1">
                    Navrhovaný klient: <span className="text-gray-300 font-medium">{suggestion.client.name}</span>
                  </p>
                )}
                {suggestion.issues.length > 0 && (
                  <div className="flex flex-wrap gap-1" aria-label="Navrhované issues">
                    {suggestion.issues.map((item) => (
                      <button
                        key={item.issueKey}
                        type="button"
                        onClick={() => {
                          setTarget('jira')
                          setIssueKey(item.issueKey)
                          setClockifyProjectId('')
                          setIssueSummary(item.summary)
                        }}
                        className={[
                          'relative group rounded px-2 py-0.5 text-xs border transition-colors',
                          target === 'jira' && issueKey === item.issueKey
                            ? 'border-yellow-400 bg-yellow-400/10 text-yellow-300'
                            : 'border-gray-600 bg-gray-800/60 text-gray-400 hover:border-gray-500 hover:text-gray-200',
                        ].join(' ')}
                      >
                        {item.issueKey}
                        {item.summary && (
                          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap rounded border border-gray-600 bg-gray-900 px-2 py-1 text-gray-200 opacity-0 transition-opacity group-hover:opacity-100 z-50">
                            {item.summary}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {suggestion.unknownDomain && (
                  <p className="text-xs text-gray-600 mt-1">
                    Neznámý klient ({suggestion.unknownDomain}){' '}
                    <button
                      type="button"
                      disabled={addingClient}
                      className="text-yellow-500 hover:text-yellow-300 underline disabled:opacity-50"
                      onClick={async () => {
                        setAddingClient(true)
                        try {
                          const token = useAuthStore.getState().accessToken ?? ''
                          await createClient(token, { name: suggestion.unknownDomain!, domain: suggestion.unknownDomain! })
                          useDbEnrichmentStore.getState().push({
                            entityType: 'client',
                            action: 'created',
                            label: suggestion.unknownDomain!,
                            message: buildDbEnrichmentMessage('client', 'created', suggestion.unknownDomain!),
                          })
                          await refetchSuggestion()
                        } catch {
                          // ignore — user can retry
                        } finally {
                          setAddingClient(false)
                        }
                      }}
                    >
                      {addingClient ? 'Přidávám…' : 'Přidat klienta'}
                    </button>
                  </p>
                )}
              </div>
            )}

            <IssueSearchInput
              value={issueKey}
              onChange={(key, summary) => { setIssueKey(key); setIssueSummary(summary) }}
              placeholder="PROJ-123"
              required
              inputRef={firstInputRef}
            />
          </div>

          {/* Clockify Project ID – hidden, auto-filled from suggestion */}
          <input
            type="hidden"
            id="clockify-project-id"
            value={clockifyProjectId}
          />

          {/* Datum */}
          <div className="flex flex-col gap-1">
            <label htmlFor="worklog-date" className="text-xs font-medium text-gray-400">Datum</label>
            <input
              id="worklog-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                reset()
              }}
              required
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 tabular-nums focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
            <WorklogProgressBar date={date} />
          </div>

          {/* Time spent */}
          <div className="flex flex-col gap-1">
            <label htmlFor="time-spent" className="text-xs font-medium text-gray-400">
              Čas <span className="text-red-400">*</span>
            </label>

            {/* Preset time chips */}
            <div className="flex flex-wrap gap-1 mb-1" aria-label="Rychlé hodnoty času">
              {['15m', '30m', '45m', '1h', '1h 30m', '2h', '3h', '4h'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setTimeInput(preset)
                    setTimeError(null)
                    reset()
                  }}
                  className={[
                    'rounded px-2 py-0.5 text-xs border transition-colors',
                    timeInput === preset
                      ? 'border-yellow-400 bg-yellow-400/10 text-yellow-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-200',
                  ].join(' ')}
                >
                  {preset}
                </button>
              ))}
            </div>

            <input
              id="time-spent"
              type="text"
              value={timeInput}
              onChange={(e) => {
                setTimeInput(e.target.value)
                setTimeError(null)
                reset()
              }}
              placeholder="1h 30m"
              required
              autoComplete="off"
              aria-describedby={timeError ? 'time-error' : 'time-hint'}
              className={[
                'rounded-md border bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600',
                'focus:outline-none focus:ring-1',
                timeError
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                  : 'border-gray-700 focus:border-yellow-400 focus:ring-yellow-400',
              ].join(' ')}
            />
            {timeError ? (
              <p id="time-error" role="alert" className="text-xs text-red-400">
                {timeError}
              </p>
            ) : (
              <p id="time-hint" className="text-xs text-gray-600">
                Formáty: 1h 30m · 90m · 1.5h
              </p>
            )}
          </div>

          {/* Comment */}
          <div className="flex flex-col gap-1">
            <label htmlFor="worklog-comment" className="text-xs font-medium text-gray-400">
              Popis
            </label>
            <input
              id="worklog-comment"
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Co jsem dělal…"
              maxLength={255}
              autoComplete="off"
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
          </div>

          {/* API error */}
          {isError && (
            <p role="alert" className="text-xs text-red-400">
              {error?.message ?? (isEditMode ? 'Worklog se nepodařilo aktualizovat.' : 'Worklog se nepodařilo uložit.')}
            </p>
          )}

          {/* Success */}
          {isSuccess && (
            <p role="status" className="text-xs text-green-400">
              ✓ Worklog uložen
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                if (!isClosing) {
                  setIsClosing(true)
                  setTimeout(onClose, 330)
                }
              }}
              className="rounded-md border border-gray-700 px-4 py-1.5 text-sm text-gray-400 hover:text-gray-100 focus:outline-none focus:ring-1 focus:ring-yellow-400"
              disabled={isClosing}
            >
              Zrušit
            </button>
            <button
              type="submit"
              disabled={isPending || isSuccess}
              className="button-action source transition-colors"
            >
              {isPending ? 'Ukládám…' : isEditMode ? 'Aktualizovat' : 'Uložit'}
            </button>
          </div>
        </form>
      </div>
      {showWorklogSuccess && (
        <WorklogSuccessModal
          savedSeconds={timeSavingsSecondsPerWorklog}
          onClose={onClose}
        />
      )}
    </div>
  )
}

export function WorklogProgressBar({ date }: { date: string }) {
  // Získat rok, měsíc a den z YYYY-MM-DD
  const [year, month, day] = date.split('-').map(Number)
  const { secondsPerDay: jiraSeconds } = useJiraWorklogs()
  const { secondsPerDay: clockifySeconds } = useClockifyWorklogs({ year, month })
  const workingDayHours = useSettingsStore((s) => s.workingDayHours)

  // Součet sekund pro daný den
  const seconds = (jiraSeconds?.[day] ?? 0) + (clockifySeconds?.[day] ?? 0)
  const targetSeconds = workingDayHours * 3600
  const percent = targetSeconds > 0 ? Math.min(100, Math.round((seconds / targetSeconds) * 100)) : 0
  // formátování času
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const formatted = `${h}:${String(m).padStart(2, '0')}`

  // Výběr barvy podle úrovně
  let barColor = '#ff5555' // default (lowest)
  const hours = seconds / 3600
  if (hours < 1) barColor = '#ff5555' // worklog-lowest
  else if (hours < 4) barColor = '#ffad55' // worklog-low
  else if (hours < 6) barColor = '#ffda55' // worklog-middle
  else if (hours < workingDayHours) barColor = '#aaff55' // worklog-good
  else barColor = '#55ff55' // worklog-best

  return (
    <div className="mt-2 mb-4">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>Výkazy v tomto dni: {formatted} / {workingDayHours}h</span>
        <span>{percent}%</span>
      </div>
      <div className="w-full h-2 bg-gray-800 rounded">
        <div
          className="h-2 rounded transition-all"
          style={{ width: `${percent}%`, background: barColor }}
        />
      </div>
    </div>
  )
}
