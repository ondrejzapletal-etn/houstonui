import { useEffect } from 'react'
import { WorklogProgressBar } from './AddWorklogModal'
import type { ContextCalendarEvent } from '@houston/shared-types'
import { useAllCalendarLinks } from '../../hooks/useUserData'
import type { DailySentEmail, DailySentSlackMessage } from '../../services/calendarClient'

export interface WorklogDetail {
  id: string
  issueId?: string
  issueName?: string
  started: string
  timeSpentSeconds: number
  comment?: string
  project?: string
  description?: string
  source: 'jira' | 'clockify'
}

interface WorklogDetailsModalProps {
  date: string
  worklogs: WorklogDetail[]
  isLoading: boolean
  isError: boolean
  onClose: () => void
  onAddWorklog?: (date: string, durationSeconds?: number, calendarEventId?: string, recurringEventId?: string, contextEmails?: string[]) => void
  onEditWorklog?: (worklog: WorklogDetail) => void
  calendarEvents?: ContextCalendarEvent[]
  calendarLoading?: boolean
  sentEmails?: DailySentEmail[]
  sentSlackMessages?: DailySentSlackMessage[]
  dailyActivityLoading?: boolean
}

export default function WorklogDetailsModal({ date, worklogs, isLoading, isError, onClose, onAddWorklog, onEditWorklog, calendarEvents = [], calendarLoading = false, sentEmails = [], sentSlackMessages = [], dailyActivityLoading = false }: WorklogDetailsModalProps) {
  const { data: allLinks = [] } = useAllCalendarLinks()
  const loggedEventIds = new Set(allLinks.map(l => l.calendarEventId))

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Převod ISO data na název dne v týdnu (česky)
  const dayNames = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']
  let dayLabel = ''
  if (date) {
    const [y, m, d] = date.split('-').map(Number)
    const jsDate = new Date(y, m - 1, d)
    dayLabel = dayNames[jsDate.getDay()]
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-gray-900 rounded-lg shadow-lg p-6 min-w-[340px] max-w-[600px] w-full max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-yellow-400">
            {date} {dayLabel && (<span className="text-gray-400 font-normal">({dayLabel})</span>)}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-yellow-400 text-xl font-bold">×</button>
        </div>

        <h4>Vykázáno</h4>
        {/* Progress bar pod nadpisem */}
        <WorklogProgressBar date={date} />
        {isLoading ? (
          <div className="text-gray-400 py-6 text-center">Načítání…</div>
        ) : isError ? (
          <div className="text-red-400 py-6 text-center">Nepodařilo se načíst detail.</div>
        ) : worklogs.length === 0 ? (
          <div className="text-gray-400 py-6 text-center">Žádné worklogy pro tento den.</div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-gray-400">
                <th className="px-2 py-1 border-b border-gray-700 text-left">Issue/Projekt</th>
                <th className="px-2 py-1 border-b border-gray-700 text-left">Detail</th>
                <th className="px-2 py-1 border-b border-gray-700 text-right">Doba</th>
                <th className="px-2 py-1 border-b border-gray-700 text-right">Akce</th>
              </tr>
            </thead>
            <tbody>
              {worklogs.map(wl => (
                <tr key={wl.id} className="border-b border-gray-800 hover:bg-gray-800">
                  <td className="px-2 py-1">{wl.issueName || '-'}<br/><span className="text-yellow-600">{wl.source === 'jira' ? 'Jira' : 'Clockify'}</span><span className="text-gray-400">: {wl.issueId || wl.project || '-'}</span> </td>
                  <td className="px-2 py-1">{wl.comment || wl.description || '-'}</td>
                  <td className="px-2 py-1 text-right">{Math.floor(wl.timeSpentSeconds / 3600)}:{String(Math.floor((wl.timeSpentSeconds % 3600) / 60)).padStart(2, '0')}</td>
                  <td className="px-2 py-1 text-right">
                    {wl.source === 'jira' && (
                      <button
                        type="button"
                        onClick={() => onEditWorklog?.(wl)}
                        className="rounded px-2 py-0.5 text-xs border border-gray-700 text-gray-400 hover:border-yellow-400 hover:text-yellow-300 transition-colors"
                        title="Upravit výkaz"
                      >
                        ✏
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Vykaž button */}
        <div className="flex justify-end mt-4">
          <button
            type="button"
            className="button-action local transition-colors"
            onClick={() => onAddWorklog?.(date)}
          >
            <img src="/img/ico-time.webp" alt="" className="w-4 h-4" />
            Vykaž
          </button>
        </div>

        <h4>Návrhy výkazů</h4>
        <div>
          {calendarLoading ? (
            <p className="text-xs text-gray-500 py-2">Načítání událostí z kalendáře…</p>
          ) : calendarEvents.length === 0 ? (
            <p className="text-xs text-gray-500 py-2">Žádné události v kalendáři pro tento den.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {calendarEvents.map(ev => {
                const startTime = ev.allDay
                  ? 'celý den'
                  : new Date(ev.start).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
                const endTime = ev.allDay
                  ? ''
                  : ` \u2013 ${new Date(ev.end).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`
                const durationSeconds = ev.allDay
                  ? 8 * 3600 // default 8h for all-day
                  : Math.max(60, Math.round((new Date(ev.end).getTime() - new Date(ev.start).getTime()) / 1000))
                const durationLabel = ev.allDay
                  ? '8h'
                  : (() => {
                      const h = Math.floor(durationSeconds / 3600)
                      const m = Math.floor((durationSeconds % 3600) / 60)
                      if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
                      return `${m}m`
                    })()
                return (
                  <li key={ev.id} className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-gray-100">{ev.summary}</span>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-gray-400">{startTime}{endTime}</span>
                        {loggedEventIds.has(ev.id) ? (
                          <span className="flex items-center gap-1 text-xs text-green-400 font-medium px-2 py-1">
                            <span>✓</span>
                            <span>Vykázáno</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="button-action local transition-colors"
                            onClick={() => onAddWorklog?.(date, durationSeconds, ev.id, ev.recurringEventId)}
                          >
                            <img src="/img/ico-time.webp" alt="" className="w-4 h-4" />
                            <span className="ml-2 text-xs text-gray-300">{durationLabel}</span>

                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {/* Gmail odeslaná pošta */}
        {dailyActivityLoading ? (
          <p className="text-xs text-gray-500 py-2">Načítání aktivity…</p>
        ) : sentEmails.length > 0 && (
          <>
            <p className="text-xs text-gray-500 mt-3 mb-1 font-medium">Odeslaná pošta</p>
            <ul className="space-y-1">
              {sentEmails.map(email => (
                <li key={email.messageId} className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-gray-100 block truncate">{email.subject}</span>
                      <span className="text-gray-500 block truncate">komu: {email.to}</span>
                      {email.snippet && <span className="text-gray-400 block truncate">{email.snippet}</span>}
                    </div>
                    <button
                      type="button"
                      className="button-action local transition-colors shrink-0"
                      onClick={() => onAddWorklog?.(date, undefined, undefined, undefined, email.to ? [email.to] : undefined)}
                    >
                      <img src="/img/ico-time.webp" alt="" className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Slack odeslané zprávy */}
        {!dailyActivityLoading && sentSlackMessages.length > 0 && (
          <>
            <p className="text-xs text-gray-500 mt-3 mb-1 font-medium">Slack zprávy</p>
            <ul className="space-y-1">
              {sentSlackMessages.map((msg, idx) => (
                <li key={`${msg.channelId}:${msg.ts ?? idx}`} className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {msg.channelName && <span className="text-gray-500 block">#{msg.channelName}</span>}
                      <span className="text-gray-100 block truncate">{msg.text}</span>
                    </div>
                    <button
                      type="button"
                      className="button-action local transition-colors shrink-0"
                      onClick={() => onAddWorklog?.(date)}
                    >
                      <img src="/img/ico-time.webp" alt="" className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Vykaž button */}
        <div className="flex justify-end mt-4">
          <button
            type="button"
            className="button-action local transition-colors"
            onClick={() => onAddWorklog?.(date)}
          >
            <img src="/img/ico-time.webp" alt="" className="w-4 h-4" />
            Vykaž
          </button>
        </div>
      </div>
    </div>
  )
}
