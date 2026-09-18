import { Fragment, useState, useMemo } from 'react'
import { getCzechHolidays } from './czechHolidays'
import type {
  JiraWorklogDayEntry,
  ClockifyWorklogDayEntry,
  ContextCalendarEvent,
  MonthlyIssueWorklogEntry,
  MonthlyWorklogIssueEntry,
} from '@houston/shared-types'
import WorklogDetailsModal, { WorklogDetail } from './WorklogDetailsModal'
import { useJiraWorklogs } from '../../hooks/useJiraWorklogs'
import { useClockifyWorklogs } from '../../hooks/useClockifyWorklogs'
import useCalendarEvents from '../../hooks/useCalendarEvents'
import useDailyActivity from '../../hooks/useDailyActivity'
import { useConnectors } from '../../hooks/useConnectors'
import { useQueryClient } from '@tanstack/react-query'
import { useSettingsStore } from '../../store/settingsStore'
import { useAuthStore } from '../../store/authStore'
import { fetchJiraWorklogsDay, fetchClockifyWorklogsDay } from '../../services/connectorsClient'
import { fetchCalendarRange } from '../../services/calendarClient'
import type { DailyActivityData } from '../../services/calendarClient'
import AddWorklogModal from './AddWorklogModal'
import KnowledgeTasksSection from './KnowledgeTasksSection'
import { useMonthlyWorklogIssues } from '../../hooks/useMonthlyWorklogIssues'
import { useWorklogsByIssue } from '../../hooks/useWorklogsByIssue'
import { useHotSpotVacation } from '../../hooks/useHotSpotVacationQuery'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Led', 'Úno', 'Bře', 'Dub', 'Kvě', 'Čvn',
  'Čvc', 'Srp', 'Zář', 'Říj', 'Lis', 'Pro',
]

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function formatHoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

function issueIdentity(issue: MonthlyWorklogIssueEntry): string {
  return [issue.source, issue.reference, issue.clockifyProjectId ?? '', issue.title ?? ''].join(':')
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkeletonRow({ daysCount }: { daysCount: number }) {
  return (
    <div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {Array.from({ length: daysCount }, (_, i) => (
              <th
                key={i}
                className="min-w-[1.7rem] border border-gray-700 px-0.5 py-1 text-center font-normal text-gray-500"
              >
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {Array.from({ length: daysCount }, (_, i) => (
              <td
                key={i}
                className="border border-gray-700 px-0.5 py-1 text-center animate-pulse"
              >
                <div className="mx-auto h-3 w-4 rounded bg-gray-700" />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── MonthSummary ─────────────────────────────────────────────────────────────

function MonthSummary({ year, month, secondsPerDay, workingDayHours, vacationSeconds, vacationAvailable }: {
  year: number
  month: number
  secondsPerDay: Record<number, number>
  workingDayHours: number
  vacationSeconds: number
  vacationAvailable: boolean
}) {
  const now = new Date()
  const isCurrentMonth = now.getFullYear() === year && (now.getMonth() + 1) === month
  const lastDay = isCurrentMonth ? now.getDate() : daysInMonth(year, month)

  // Svátky v měsíci
  const holidays = getCzechHolidays(year)
  let holidaysOnWorkdays = 0
  let fondHours = 0
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dow = new Date(year, month - 1, d).getDay()
    const isHoliday = holidays[dateStr] !== undefined
    const isWorkday = dow !== 0 && dow !== 6 && !isHoliday
    if (dow !== 0 && dow !== 6 && isHoliday) holidaysOnWorkdays++
    if (!isWorkday) continue
    if (
      isCurrentMonth &&
      d === now.getDate()
    ) {
      // For today, count only elapsed hours since 9:00, max workingDayHours, min 0
      const workStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0)
      let elapsed = (now.getTime() - workStart.getTime()) / 3600000 // in hours
      if (elapsed < 0) elapsed = 0
      if (elapsed > workingDayHours) elapsed = workingDayHours
      fondHours += elapsed
    } else {
      fondHours += workingDayHours
    }
  }
  const fondSeconds = Math.round(fondHours * 3600)
  const holidaySeconds = holidaysOnWorkdays * workingDayHours * 3600

  let loggedSeconds = 0
  for (let d = 1; d <= lastDay; d++) {
    loggedSeconds += secondsPerDay[d] ?? 0
  }

  const format = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h}:${String(m).padStart(2, '0')}`
  }
  const vacationContributionSeconds = vacationAvailable ? vacationSeconds : 0
  const completedSeconds = loggedSeconds + holidaySeconds + vacationContributionSeconds
  const percentNumber = fondSeconds > 0 ? (completedSeconds / fondSeconds) * 100 : 0
  const percent = percentNumber
  const percentDisplay = String(Math.round(percentNumber))

  let barColor = '#ff5555'
  const hours = completedSeconds / 3600
  // Color thresholds based on fondHours (max possible for the period)
  if (hours < 1) barColor = '#ff5555'
  else if (hours < 4) barColor = '#ffad55'
  else if (hours < 6) barColor = '#ffda55'
  else if (fondHours > 0 && hours < fondHours) barColor = '#aaff55'
  else barColor = '#55ff55'

  return (
    <div className="mt-6 mb-2">
      <div className="flex flex-wrap gap-6 items-end text-sm text-gray-300">
        <div>
          <span className="text-gray-400">Pracovní fond do teď:</span>{' '}
          <span className="font-semibold">{format(fondSeconds)}</span>
        </div>
        <div>
          <span className="text-gray-400">Celkem vykázáno:</span>{' '}
          <span className="font-semibold">{format(loggedSeconds)}</span>
        </div>
        <div>
          <span className="text-gray-400">Svátky:</span>{' '}
          <span className="font-semibold">{format(holidaySeconds)}</span>
        </div>
        <div>
          <span className="text-gray-400">Dovolená:</span>{' '}
          <span className="font-semibold">{vacationAvailable ? format(vacationSeconds) : '—'}</span>
        </div>
        <div>
          <span className="text-gray-400">Plnění:</span>{' '}
          <span className="font-semibold">{percentDisplay}%</span>
        </div>
      </div>
      <div className="w-full h-1 bg-gray-800 rounded">
        <div
          className="h-1 rounded transition-all"
          style={{ width: `${Math.min(percent, 100).toFixed(1)}%`, background: barColor }}
        />
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────



// ─── Main component ───────────────────────────────────────────────────────────

type AddWorklogDate =
  | string
  | {
      date: string
      durationSeconds?: number
      calendarEventId?: string
      recurringEventId?: string
      contextEmails?: string[]
      defaultIssueKey?: string
      defaultTarget?: 'jira' | 'clockify'
      editWorklogId?: string
      editIssueKey?: string
      editComment?: string
    }
  | null

// ─── Issue Row Component ──────────────────────────────────────────────────────

interface IssueRowsProps {
  issue: MonthlyWorklogIssueEntry
  year: number
  month: number
  canReport: boolean
  isExpanded: boolean
  onToggle: () => void
  onReport: () => void
  onEditWorklog: (worklog: MonthlyIssueWorklogEntry) => void
}

function IssueRows({ issue, year, month, canReport, isExpanded, onToggle, onReport, onEditWorklog }: IssueRowsProps) {
  const { worklogs, isLoading } = useWorklogsByIssue({
    year,
    month,
    source: issue.source,
    reference: issue.reference,
    enabled: isExpanded,
  })

  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer' }}
        className="border-b border-gray-800 hover:bg-gray-800"
      >
        <td className="px-2 py-1 text-yellow-400 font-semibold">
          {issue.source === 'jira' ? 'Jira' : 'Clockify'}
        </td>
        <td className="px-2 py-1">{issue.reference}</td>
        <td className="px-2 py-1 text-gray-300">{issue.title || '-'}</td>
        <td className="px-2 py-1 text-right">{formatHoursMinutes(issue.totalSeconds)}</td>
        <td className="px-2 py-1 text-right">
          <button
            type="button"
            className="button-action local transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canReport}
            title={canReport ? 'Vykaž' : 'chybí Jira issue key'}
            onClick={(e) => {
              e.stopPropagation()
              onReport()
            }}
          >
            <img src="/img/ico-time.webp" alt="" className="w-4 h-4" />
            Vykaž
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-gray-800 bg-gray-950">
          <td colSpan={5} className="px-2 py-2">
            {isLoading ? (
              <p className="text-xs text-gray-500">Načítání…</p>
            ) : worklogs.length === 0 ? (
              <p className="text-xs text-gray-500">Žádné worklogy</p>
            ) : (
              <div className="pl-2 space-y-1">
                {worklogs.map((wl) => (
                  <div
                    key={wl.id}
                    className="flex gap-2 text-xs border-l-2 border-gray-700 pl-2 py-1 text-gray-300"
                  >
                    <span className="flex-1">{wl.comment || wl.description || '(bez komentáře)'}</span>
                    <span className="text-gray-500">{formatHoursMinutes(wl.timeSpentSeconds)}</span>
                    {issue.source === 'jira' && wl.issueId ? (
                      <button
                        type="button"
                        title="Upravit výkaz"
                        className="text-yellow-400 hover:text-yellow-300 transition"
                        onClick={(e) => {
                          e.stopPropagation()
                          onEditWorklog(wl)
                        }}
                      >
                        ✎
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function WorklogsSection() {
  const { connect, connectingType } = useConnectors()
  const workingDayHours = useSettingsStore((s) => s.workingDayHours)
  const {
    secondsPerDay: jiraSeconds,
    year,
    month,
    isLoading: jiraLoading,
    isError: jiraError,
    isJiraConnected,
    prevMonth,
    nextMonth,
  } = useJiraWorklogs()

  const {
    secondsPerDay: clockifySeconds,
    isLoading: clockifyLoading,
    isClockifyConnected,
  } = useClockifyWorklogs({ year, month })

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalDate, setModalDate] = useState<string | null>(null)
  const [modalWorklogs, setModalWorklogs] = useState<WorklogDetail[]>([])
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError] = useState(false)
  const [addWorklogDate, setAddWorklogDate] = useState<AddWorklogDate>(null)
  const [activeTab, setActiveTab] = useState<'issues' | 'projekty' | 'ukoly' | null>(null)
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null)
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const showMonthlyIssues = activeTab === 'issues'
  const showProjects = activeTab === 'projekty'
  const showTasks = activeTab === 'ukoly'

  const hotSpotVacation = useHotSpotVacation(year, month, workingDayHours)

  const accessToken = useAuthStore((s) => s.accessToken)

  const dayEventsQuery = useCalendarEvents(modalDate, { enabled: !!modalDate })
  const dailyActivityQuery = useDailyActivity(modalDate, { enabled: !!modalDate })
  const dayEvents = (dayEventsQuery.data ?? []) as ContextCalendarEvent[]
  const dayEventsLoading = dayEventsQuery.isLoading
  const dailyActivity = dailyActivityQuery.data as DailyActivityData | undefined
  const dailyActivityLoading = dailyActivityQuery.isLoading
  const queryClient = useQueryClient()
  const {
    issues: monthlyIssues,
    isLoading: monthlyIssuesLoading,
    isError: monthlyIssuesError,
  } = useMonthlyWorklogIssues({
    year,
    month,
    enabled: showMonthlyIssues || showProjects,
  })

  // Aggregate issues by project key for Projekty tab
  const projectAggregates = useMemo(() => {
    const map = new Map<string, {
      project: string
      issues: MonthlyWorklogIssueEntry[]
      totalSeconds: number
    }>()
    for (const issue of monthlyIssues) {
      const match = issue.reference.toUpperCase().match(/^([A-Z][A-Z0-9_]*)-\d+$/)
      const projectKey = match ? match[1] : issue.reference
      const existing = map.get(projectKey)
      if (existing) {
        existing.issues.push(issue)
        existing.totalSeconds += issue.totalSeconds
      } else {
        map.set(projectKey, { project: projectKey, issues: [issue], totalSeconds: issue.totalSeconds })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds)
  }, [monthlyIssues])

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const currentDay = now.getDate()

  const numDays = daysInMonth(year, month)
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`

  const secondsPerDay: Record<number, number> = {}
  for (let d = 1; d <= numDays; d++) {
    const total = (jiraSeconds[d] ?? 0) + (clockifySeconds[d] ?? 0)
    if (total > 0) secondsPerDay[d] = total
  }

  const isLoading = (isJiraConnected && jiraLoading) || (isClockifyConnected && clockifyLoading)
  const isError = jiraError

  async function openWorklogDetails(day: number) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    setModalDate(date)
    setIsModalOpen(true)
    setModalLoading(true)
    setModalError(false)
    // Start fetching calendar events immediately to reduce waiting time in modal
    try {
      const start = new Date(`${date}T00:00:00`)
      const end = new Date(`${date}T23:59:59.999`)
      void queryClient.prefetchQuery({
        queryKey: ['calendarEvents', date],
        queryFn: async () => {
          const res = await fetchCalendarRange(accessToken ?? '', start.toISOString(), end.toISOString())
          return res.events ?? res
        },
      })
    } catch {
      // ignore prefetch errors — modal will handle empty state
    }
    try {
      const token = accessToken ?? ''
      const [jiraResult, clockifyResult] = await Promise.allSettled([
        isJiraConnected ? fetchJiraWorklogsDay(token, date) : Promise.resolve(null),
        isClockifyConnected ? fetchClockifyWorklogsDay(token, date) : Promise.resolve(null),
      ])
      const worklogs: WorklogDetail[] = []
      if (jiraResult.status === 'fulfilled' && jiraResult.value) {
        worklogs.push(...jiraResult.value.worklogs.map((w: JiraWorklogDayEntry) => ({
          id: w.id,
          issueId: w.issueId,
          issueName: w.issueName,
          started: w.started,
          timeSpentSeconds: w.timeSpentSeconds,
          comment: w.comment,
          source: 'jira' as const,
        })))
      }
      if (clockifyResult.status === 'fulfilled' && clockifyResult.value) {
        worklogs.push(...clockifyResult.value.worklogs.map((w: ClockifyWorklogDayEntry) => ({
          id: w.id,
          project: w.project,
          description: w.description,
          started: w.started,
          timeSpentSeconds: w.timeSpentSeconds,
          source: 'clockify' as const,
        })))
      }
      if (jiraResult.status === 'rejected' && clockifyResult.status === 'rejected') {
        setModalError(true)
      } else {
        setModalWorklogs(worklogs)
      }
      setModalLoading(false)
    } catch {
      setModalError(true)
      setModalLoading(false)
    }
  }

  function closeWorklogDetails() {
    setIsModalOpen(false)
    setModalDate(null)
    setModalWorklogs([])
    setModalLoading(false)
    setModalError(false)
  }

  return (
    <section aria-labelledby="worklog-heading">
      <div className=" p-2">
        {/* Heading row */}
        <div className="flex items-center justify-between mb-2">
          <h2
            id="worklog-heading"
            className="text-lg font-bold uppercase tracking-wide"
          >
            Výkazy
          </h2>

          <div className="flex items-center gap-3">
            {isJiraConnected && (
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="button-action local transition-colors"
                aria-label="Vykaž entry"
              >
                <img src="/img/ico-time.webp" alt="" className="w-4 h-4" />
                Vykaž
              </button>
            )}

            {isJiraConnected && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="rounded px-2 py-0.5 text-sm text-gray-400 hover:text-gray-100 focus:outline-none focus:ring-1 focus:ring-yellow-400" style={{ color: 'var(--dm-primary-300)' }}
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <span className="text-sm font-medium text-gray-300 tabular-nums w-20 text-center">
                  {monthLabel}
                </span>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="rounded px-2 py-0.5 text-sm text-gray-400 hover:text-gray-100 focus:outline-none focus:ring-1 focus:ring-yellow-400" style={{ color: 'var(--dm-primary-300)' }}
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        {!isJiraConnected ? (
          <div className="flex flex-col items-start gap-3 py-1">
            <p className="text-sm text-gray-500">
              Connect your Jira account to see your worklog summary.
            </p>
            <button
              type="button"
              onClick={() => connect('jira')}
              disabled={connectingType === 'jira'}
              className="rounded-md bg-yellow-400 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {connectingType === 'jira' ? 'Opening browser…' : 'Connect Jira'}
            </button>
          </div>
        ) : isError ? (
          <p role="alert" className="text-sm text-red-400">
            Could not load worklogs. Check your Jira connection.
          </p>
        ) : isLoading ? (
          <SkeletonRow daysCount={numDays} />
        ) : (
          <div>
            <table className="rounded-xl w-full border-collapse text-xs" style={{background: 'var(--dm-bg-500)'}} aria-label={`Worklogs ${monthLabel}`}>
              <thead>
                <tr>
                  {Array.from({ length: numDays }, (_, i) => {
                    const day = i + 1
                    const isToday =
                      year === currentYear && month === currentMonth && day === currentDay
                    const dayOfWeek = new Date(year, month - 1, day).getDay()
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    const holidayName = getCzechHolidays(year)[dateStr]
                    return (
                      <th
                        key={day}
                        scope="col"
                        style={isToday ? { backgroundColor: '#1d2c4b' } : isWeekend ? { backgroundColor: '#2b2b2b' } : holidayName ? { backgroundColor: '#2b2b2b' } : undefined}
                        className={[
                          'min-w-[1.7rem] border border-gray-700 px-0.5 py-1 text-center font-normal',
                          isToday ? 'text-yellow-400 font-semibold' : holidayName ? 'text-gray-500 font-semibold' : 'text-gray-500',
                        ].join(' ')}
                        aria-label={holidayName ? `${day} (${holidayName})` : isToday ? `${day} (dnes)` : String(day)}
                        title={holidayName || undefined}
                      >
                        {day}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {Array.from({ length: numDays }, (_, i) => {
                    const day = i + 1
                    const seconds = secondsPerDay[day] ?? 0
                    const isToday =
                      year === currentYear && month === currentMonth && day === currentDay
                    const dayOfWeek = new Date(year, month - 1, day).getDay()
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    const holidayName = getCzechHolidays(year)[dateStr]
                    const hasTime = seconds > 0
                    let worklogClass = ''
                    const hours = seconds / 3600
                    if (hasTime) {
                      if (hours < 1) worklogClass = 'worklog-lowest'
                      else if (hours < 4) worklogClass = 'worklog-low'
                      else if (hours < 6) worklogClass = 'worklog-middle'
                      else if (hours < workingDayHours) worklogClass = 'worklog-good'
                      else worklogClass = 'worklog-best'
                    }

                    return (
                      <td
                        key={day}
                        style={isToday ? { backgroundColor: '#1d2c4b' } : isWeekend ? { backgroundColor: '#2b2b2b' } : holidayName ? { backgroundColor: '#2b2b2b' } : undefined}
                        className={[
                          'border border-gray-700 px-0.5 py-1 text-center tabular-nums transition',
                          hasTime
                            ? 'cursor-pointer hover:bg-gray-800 text-gray-100'
                            : 'cursor-pointer hover:bg-gray-800',
                          hasTime
                            ? worklogClass
                            : holidayName
                              ? 'text-gray-600 font-semibold'
                              : 'text-gray-600',
                        ].join(' ')}
                        aria-label={hasTime ? `${day}. ${monthLabel}: ${formatHoursMinutes(seconds)}` : `${day}. ${monthLabel}: 0:00`}
                        title={holidayName ? holidayName : hasTime ? 'Zobrazit detail worklogů' : undefined}
                        onClick={() => openWorklogDetails(day)}
                      >
                        {hasTime ? formatHoursMinutes(seconds) : '—'}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>

            {/* Souhrn za měsíc pod tabulkou */}
            <MonthSummary
              year={year}
              month={month}
              secondsPerDay={secondsPerDay}
              workingDayHours={workingDayHours}
              vacationSeconds={hotSpotVacation.seconds}
              vacationAvailable={hotSpotVacation.isConnected && !hotSpotVacation.isError}
            />

            <div className="mt-8 gap-2 flex flex-wrap items-center">
              <button
                type="button"
                onClick={() => setActiveTab((v) => v === 'issues' ? null : 'issues')}
                className="button-tab"
                aria-label="Issues v tomto měsíci"
              >
                Issues
              </button>
              <button
                type="button"
                onClick={() => setActiveTab((v) => v === 'projekty' ? null : 'projekty')}
                className="button-tab"
                aria-label="Projekty v tomto měsíci"
              >
                Projekty
              </button>
              <button
                type="button"
                onClick={() => setActiveTab((v) => v === 'ukoly' ? null : 'ukoly')}
                className="button-tab"
                aria-label="Úkoly v tomto měsíci"
              >
                Úkoly
              </button>
            </div>

            {showMonthlyIssues && (
              <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                {monthlyIssuesLoading ? (
                  <p className="text-xs text-gray-500">Načítání issues…</p>
                ) : monthlyIssuesError ? (
                  <p className="text-xs text-red-400">Nepodařilo se načíst issues pro vybraný měsíc.</p>
                ) : monthlyIssues.length === 0 ? (
                  <p className="text-xs text-gray-500">Pro tento měsíc nejsou k dispozici žádné issues.</p>
                ) : (
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-gray-400">
                        <th className="px-2 py-1 border-b border-gray-700 text-left">Zdroj</th>
                        <th className="px-2 py-1 border-b border-gray-700 text-left">Issue/Projekt</th>
                        <th className="px-2 py-1 border-b border-gray-700 text-left">Název/Detail</th>
                        <th className="px-2 py-1 border-b border-gray-700 text-right">Celkem</th>
                        <th className="px-2 py-1 border-b border-gray-700 text-right">Akce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyIssues.map((issue) => {
                        const canReport = typeof issue.jiraIssueKey === 'string' && issue.jiraIssueKey.length > 0
                        const isExpanded = expandedIssue === issueIdentity(issue)
                        return (
                          <IssueRows
                            key={`${issue.source}:${issue.reference}:${issue.title ?? ''}`}
                            issue={issue}
                            year={year}
                            month={month}
                            canReport={canReport}
                            isExpanded={isExpanded}
                            onToggle={() =>
                              setExpandedIssue(isExpanded ? null : issueIdentity(issue))
                            }
                            onReport={() => {
                              if (!issue.jiraIssueKey) return
                              setAddWorklogDate({
                                date: new Date().toISOString().substring(0, 10),
                                defaultIssueKey: issue.jiraIssueKey,
                              })
                              setIsModalOpen(true)
                            }}
                            onEditWorklog={(worklog) => {
                              setAddWorklogDate({
                                date: worklog.started.substring(0, 10),
                                durationSeconds: worklog.timeSpentSeconds,
                                editWorklogId: worklog.id,
                                editIssueKey: worklog.issueId ?? issue.reference,
                                editComment: worklog.comment,
                              })
                              setIsModalOpen(true)
                            }}
                          />
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showProjects && (
        <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/60 p-3">
          {monthlyIssuesLoading ? (
            <p className="text-xs text-gray-500">Načítání projektů…</p>
          ) : monthlyIssuesError ? (
            <p className="text-xs text-red-400">Nepodařilo se načíst projekty pro vybraný měsíc.</p>
          ) : projectAggregates.length === 0 ? (
            <p className="text-xs text-gray-500">Pro tento měsíc nejsou k dispozici žádné projekty.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th className="px-2 py-1 border-b border-gray-700 text-left">Projekt</th>
                  <th className="px-2 py-1 border-b border-gray-700 text-right">Počet položek</th>
                  <th className="px-2 py-1 border-b border-gray-700 text-right">Celkem</th>
                </tr>
              </thead>
              <tbody>
                {projectAggregates.map((row) => {
                  const isExpanded = expandedProject === row.project
                  return (
                    <Fragment key={row.project}>
                      <tr
                        className="cursor-pointer border-b border-gray-800 hover:bg-gray-800"
                        onClick={() => setExpandedProject(isExpanded ? null : row.project)}
                      >
                        <td className="px-2 py-1 font-medium">{row.project}</td>
                        <td className="px-2 py-1 text-right text-gray-300">{row.issues.length}</td>
                        <td className="px-2 py-1 text-right">{formatHoursMinutes(row.totalSeconds)}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-gray-800 bg-gray-950">
                          <td colSpan={3} className="p-2">
                            <table className="w-full border-collapse text-xs">
                              <tbody>
                                {row.issues.map((issue) => {
                                  const canReport = typeof issue.jiraIssueKey === 'string' && issue.jiraIssueKey.length > 0
                                  const isIssueExpanded = expandedIssue === issueIdentity(issue)
                                  return (
                                    <IssueRows
                                      key={issueIdentity(issue)}
                                      issue={issue}
                                      year={year}
                                      month={month}
                                      canReport={canReport}
                                      isExpanded={isIssueExpanded}
                                      onToggle={() => setExpandedIssue(isIssueExpanded ? null : issueIdentity(issue))}
                                      onReport={() => {
                                        if (!issue.jiraIssueKey) return
                                        setAddWorklogDate({
                                          date: new Date().toISOString().substring(0, 10),
                                          defaultIssueKey: issue.jiraIssueKey,
                                        })
                                        setIsModalOpen(true)
                                      }}
                                      onEditWorklog={(worklog) => {
                                        setAddWorklogDate({
                                          date: worklog.started.substring(0, 10),
                                          durationSeconds: worklog.timeSpentSeconds,
                                          editWorklogId: worklog.id,
                                          editIssueKey: worklog.issueId ?? issue.reference,
                                          editComment: worklog.comment,
                                        })
                                        setIsModalOpen(true)
                                      }}
                                    />
                                  )
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showTasks && <KnowledgeTasksSection />}

      {/* Vykaž Modal */}
      {isModalOpen && !modalDate && (
        <AddWorklogModal
          defaultDate={typeof addWorklogDate === 'string'
            ? addWorklogDate
            : addWorklogDate && typeof addWorklogDate === 'object' && 'date' in addWorklogDate
              ? addWorklogDate.date
              : new Date().toISOString().substring(0, 10)}
          defaultDurationSeconds={typeof addWorklogDate === 'object' && addWorklogDate && 'durationSeconds' in addWorklogDate && addWorklogDate.durationSeconds ? addWorklogDate.durationSeconds : undefined}
          calendarEventId={typeof addWorklogDate === 'object' && addWorklogDate && 'calendarEventId' in addWorklogDate ? addWorklogDate.calendarEventId : undefined}
          recurringEventId={typeof addWorklogDate === 'object' && addWorklogDate && 'recurringEventId' in addWorklogDate ? addWorklogDate.recurringEventId : undefined}
          contextEmails={typeof addWorklogDate === 'object' && addWorklogDate && 'contextEmails' in addWorklogDate ? addWorklogDate.contextEmails : undefined}
          defaultIssueKey={typeof addWorklogDate === 'object' && addWorklogDate && 'defaultIssueKey' in addWorklogDate ? addWorklogDate.defaultIssueKey : undefined}
          defaultTarget={typeof addWorklogDate === 'object' && addWorklogDate && 'defaultTarget' in addWorklogDate ? addWorklogDate.defaultTarget : undefined}
          editWorklogId={typeof addWorklogDate === 'object' && addWorklogDate && 'editWorklogId' in addWorklogDate ? addWorklogDate.editWorklogId : undefined}
          editIssueKey={typeof addWorklogDate === 'object' && addWorklogDate && 'editIssueKey' in addWorklogDate ? addWorklogDate.editIssueKey : undefined}
          editComment={typeof addWorklogDate === 'object' && addWorklogDate && 'editComment' in addWorklogDate ? addWorklogDate.editComment : undefined}
          onClose={() => {
            setIsModalOpen(false)
            setAddWorklogDate(null)
          }}
        />
      )}

      {/* Worklog Details Modal */}
      {isModalOpen && modalDate && (
        <WorklogDetailsModal
          date={modalDate}
          worklogs={modalWorklogs}
          isLoading={modalLoading}
          isError={modalError}
          onClose={closeWorklogDetails}
          calendarEvents={dayEvents}
          calendarLoading={dayEventsLoading}
          sentEmails={dailyActivity?.sentEmails}
          sentSlackMessages={dailyActivity?.sentSlackMessages}
          dailyActivityLoading={dailyActivityLoading}
          onAddWorklog={(date, durationSeconds, calendarEventId, recurringEventId, contextEmails) => {
            setModalDate(null)
            setModalWorklogs([])
            setModalLoading(false)
            setModalError(false)
            if (durationSeconds || calendarEventId || contextEmails?.length) {
              setAddWorklogDate({ date, durationSeconds, calendarEventId, recurringEventId, contextEmails })
            } else {
              setAddWorklogDate(date)
            }
          }}
          onEditWorklog={(worklog) => {
            setModalDate(null)
            setModalWorklogs([])
            setModalLoading(false)
            setModalError(false)
            setAddWorklogDate({
              date: worklog.started.substring(0, 10),
              durationSeconds: worklog.timeSpentSeconds,
              defaultTarget: worklog.source,
              editWorklogId: worklog.id,
              editIssueKey: worklog.issueId,
              editComment: worklog.comment,
            })
          }}
        />
      )}
    </section>
  )
}
