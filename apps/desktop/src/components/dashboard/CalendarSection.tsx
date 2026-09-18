import type { ContextCalendarEvent } from '@houston/shared-types'
import { useDashboardCalendarEvents } from '../../hooks/useCalendarEvents'

function toDateKey(iso: string): string {
  return iso.substring(0, 10)
}

function EventList({ events }: { events: ContextCalendarEvent[] }) {
  if (events.length === 0) {
    return <p className="px-4 py-4 text-xs text-gray-500">Žádné události.</p>
  }
  return (
    <ul className="divide-y divide-gray-800">
      {events.map(ev => {
        const startTime = ev.allDay
          ? 'celý den'
          : new Date(ev.start).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
        const endTime = ev.allDay
          ? ''
          : ` – ${new Date(ev.end).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`
        return (
          <li key={ev.id} className="px-3 py-2.5 space-y-0.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-gray-100 leading-snug">
                <img src="/img/ico-event.webp" alt="" className="w-3 h-3 mr-1 inline-block" />
                {ev.summary}</span>
              <span className="shrink-0 text-xs text-gray-400">{startTime}{endTime}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
                <div>
                {ev.location && (
                <p className="text-xs text-gray-500 truncate">{ev.location}</p>
                )}
                </div>
                {ev.meetLink && (
                <a
                    href={ev.meetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300"
                >
                    Google Meet ↗
                </a>
                )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default function CalendarSection() {
  const { data, isLoading, error } = useDashboardCalendarEvents()

  const events: ContextCalendarEvent[] = data ?? []

  const todayKey = toDateKey(new Date().toISOString())
  const tomorrowKey = toDateKey(new Date(Date.now() + 86_400_000).toISOString())

  const todayEvents = events.filter(ev => toDateKey(ev.start) === todayKey)
  const tomorrowEvents = events.filter(ev => toDateKey(ev.start) === tomorrowKey)

  const todayLabel = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' })
  const tomorrowLabel = new Date(Date.now() + 86_400_000).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' })

  return (
    <section>
      <h2 className="text-lg font-bold uppercase tracking-wide mb-2">Kalendář</h2>
      {isLoading ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-6 text-center text-sm text-gray-500">Načítání…</div>
      ) : error ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-6 text-center text-sm text-red-400">{error.message}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded border border-gray-800 bg-gray-900" style={{background: 'var(--dm-bg-500)', overflow:'hidden'}}>
            <div className="px-3 py-2 border-b border-gray-800" style={{background: 'var(--dm-bg-550)'}}>
              <span className="text-xs font-semibold text-yellow-400 capitalize">{todayLabel}</span>
            </div>
            <EventList events={todayEvents} />
          </div>
          <div className="rounded border border-gray-800 bg-gray-900" style={{background: 'var(--dm-bg-500)', overflow:'hidden'}}>
            <div className="px-3 py-2 border-b border-gray-800" style={{background: 'var(--dm-bg-550)'}}>
              <span className="text-xs font-semibold text-yellow-400 capitalize">{tomorrowLabel}</span>
            </div>
            <EventList events={tomorrowEvents} />
          </div>
        </div>
      )}
    </section>
  )
}
