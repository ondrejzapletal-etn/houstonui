import { useState } from 'react'
import AppLayout from '../components/layout/AppLayout'
import { useQueryClient } from '@tanstack/react-query'
import { useContext } from '../hooks/useContext'
import { useClients, useProjects, useAllIssues, useAllCalendarLinks } from '../hooks/useUserData'
import type {
  ContextEmail,
  ContextSlackChannel,
  ContextCalendarEvent,
  ProjectDto,
  JiraIssueDto,
  CalendarIssueLinkDto,
} from '@houston/shared-types'

export default function ContextPage() {
  const { data, isLoading, isError, errorMessage, refetch, isFetching } = useContext()
  const { data: clients = [] } = useClients()
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const { data: issues = [], isLoading: issuesLoading } = useAllIssues()
  const { data: calendarLinks = [], isLoading: linksLoading } = useAllCalendarLinks()
  const queryClient = useQueryClient()

  const refreshAll = async () => {
    // Invalidate lists so their hooks refetch, then refetch context data
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['issues'] }),
      queryClient.invalidateQueries({ queryKey: ['calendarLinks'] }),
    ])
    await refetch()
  }

  // Build a clientId→name lookup for project display
  const clientMap = new Map(clients.map((c) => [c.id, c.name]))

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Context</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Aktuální data z připojených služeb: nepřečtená komunikace, kalendář a dnešní výkazy. Používají se při spuštění scanu; otevření této stránky je pouze načte a neukládá do znalostní báze.
            </p>
            {data && (
              <p className="text-sm text-gray-500 mt-0.5">
                Načteno: {new Date(data.fetchedAt).toLocaleString('cs-CZ')}
              </p>
            )}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isFetching ? 'Načítám…' : 'Obnovit'}
          </button>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-gray-900 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
            {errorMessage ?? 'Nepodařilo se načíst data.'}
          </div>
        )}

        {/* ── Uložená uživatelská data ── */}
        <div className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold text-gray-300 border-b border-gray-700 pb-2">
            Uložená data
          </h2>
          <ClientsSection clients={clients} isLoading={false} onSaved={refreshAll} />
          <div className="px-1 pb-1 text-xs text-gray-400">
            Klienti se spravují ručně. Každý projekt musí mít přiřazeného klienta.
          </div>

          {/* Projekty – popis plnění */}
          <ProjectsSection projects={projects} clients={clients} clientMap={clientMap} isLoading={projectsLoading} onSaved={refreshAll} />
          <div className="px-1 pb-1 text-xs text-gray-400">
            Projekty se plní při vytvoření, úpravě nebo smazání projektu v aplikaci (sekce Projekty/Proposals). Načítají se automaticky při otevření této stránky. Každý uživatel vidí pouze své projekty, které jsou navázány na klienty.
          </div>

          {/* Jira Issues – popis plnění */}
          <IssuesSection issues={issues} isLoading={issuesLoading} onSaved={refreshAll} />
          <div className="px-1 pb-1 text-xs text-gray-400">
            Seznam Jira Issues (cache) se plní automaticky při schválení návrhu na vykázání práce (proposals), nebo ručně při propojení události s issue. Načítá se automaticky při otevření této stránky. Každý uživatel má vlastní cache a může issue odebrat.
          </div>

          {/* Vazby událost → Issue – popis plnění */}
          <CalendarLinksSection links={calendarLinks} isLoading={linksLoading} onSaved={refreshAll} />
          <div className="px-1 pb-1 text-xs text-gray-400">
            Vazby mezi událostmi v kalendáři a Jira Issues se vytvářejí při vykazování práce na události a propojení s issue. Načítají se automaticky při otevření této stránky. Každý uživatel vidí pouze své vazby, které se aktualizují při každém vykázání.
          </div>
        </div>

        {/* Sections */}
        {data && (
          <div className="space-y-4">
            <GmailSection emails={data.gmail.emails} error={data.gmail.error} />
            <SlackSection channels={data.slack.channels} error={data.slack.error} />
            <CalendarSection events={data.calendar.events} error={data.calendar.error} />
            <WorklogSection
              label="Jira"
              hours={data.jira.hoursToday}
              error={data.jira.error}
              color="blue"
            />
            <WorklogSection
              label="Clockify"
              hours={data.clockify.hoursToday}
              error={data.clockify.error}
              color="green"
            />
          </div>
        )}
      </div>
    </AppLayout>
  )
}

// ─── Section wrappers ─────────────────────────────────────────────────────────

interface SectionProps {
  title: string
  count: number
  error?: string
  children: React.ReactNode
}

function Section({ title, count, error, children }: SectionProps) {
  const [open, setOpen] = useState(true)

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">{title}</span>
          {error ? (
            <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">
              Chyba
            </span>
          ) : (
            <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
              {count}
            </span>
          )}
        </div>
        <span className="text-gray-500 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-800">
          {error ? (
            <p className="text-sm text-red-400 px-4 py-3">{error}</p>
          ) : count === 0 ? (
            <p className="text-sm text-gray-500 px-4 py-3">Žádné položky.</p>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

function GmailSection({ emails, error }: { emails: ContextEmail[]; error?: string }) {
  return (
    <Section title="Gmail" count={emails.length} error={error}>
      <ul className="divide-y divide-gray-800">
        {emails.map((email) => (
          <li key={email.messageId} className="px-4 py-3 space-y-0.5">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm font-medium text-white leading-snug">{email.subject}</p>
              <span className="text-xs text-gray-500 shrink-0">
                {new Date(email.receivedAt).toLocaleString('cs-CZ', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <p className="text-xs text-gray-400">{email.from}</p>
            {email.snippet && (
              <p className="text-xs text-gray-500 line-clamp-2 mt-1">{email.snippet}</p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ─── Slack ────────────────────────────────────────────────────────────────────

function SlackSection({ channels, error }: { channels: ContextSlackChannel[]; error?: string }) {
  const totalMessages = channels.reduce((s, c) => s + c.messages.length, 0)

  return (
    <Section title="Slack" count={totalMessages} error={error}>
      <div className="divide-y divide-gray-800">
        {channels.map((channel) => (
          <div key={channel.channelId} className="px-4 py-3">
            <p className="text-xs font-semibold text-indigo-400 mb-2">#{channel.channelName}</p>
            <ul className="space-y-2">
              {channel.messages.map((msg) => (
                <li key={msg.ts} className="text-sm text-gray-300">
                  <span className="text-gray-500 text-xs mr-1.5">@{msg.userId}</span>
                  {msg.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

function CalendarSection({ events, error }: { events: ContextCalendarEvent[]; error?: string }) {
  return (
    <Section title="Kalendář" count={events.length} error={error}>
      <ul className="divide-y divide-gray-800">
        {events.map((event) => {
          const start = new Date(event.start)
          const end = new Date(event.end)
          const fmt = (d: Date) =>
            event.allDay
              ? d.toLocaleDateString('cs-CZ')
              : d.toLocaleString('cs-CZ', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })
          return (
            <li key={event.id} className="px-4 py-3 space-y-0.5">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-medium text-white leading-snug">{event.summary}</p>
                <span className="text-xs text-gray-500 shrink-0 text-right">
                  {fmt(start)} – {fmt(end)}
                </span>
              </div>
              {event.location && (
                <p className="text-xs text-gray-400">{event.location}</p>
              )}
              {event.attendees.length > 0 && (
                <p className="text-xs text-gray-500">
                  {event.attendees.map((a) => a.displayName ?? a.email).join(', ')}
                </p>
              )}
              {event.meetLink && (
                <a
                  href={event.meetLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  Google Meet ↗
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

// ─── Worklogs (Jira / Clockify) ───────────────────────────────────────────────

interface WorklogSectionProps {
  label: string
  hours: number
  error?: string
  color: 'blue' | 'green'
}

function WorklogSection({ label, hours, error, color }: WorklogSectionProps) {
  const colorClass = color === 'blue' ? 'text-blue-400' : 'text-green-400'

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 px-4 py-3 flex items-center justify-between">
      <span className="font-semibold text-white">{label}</span>
      {error ? (
        <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">Chyba</span>
      ) : (
        <span className={`text-lg font-bold ${colorClass}`}>{hours.toFixed(1)} h dnes</span>
      )}
    </div>
  )
}

// ─── Clients section ──────────────────────────────────────────────────────────

import ClientEditModal from '../components/context/ClientEditModal'
import { deleteClient } from '../services/deleteClientProjectIssueLink'
import type { ClientDto } from '@houston/shared-types'

function ClientsSection({ clients, isLoading, onSaved }: { clients: ClientDto[]; isLoading: boolean; onSaved?: () => Promise<void> | void }) {
  const [editClient, setEditClient] = useState<ClientDto | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const accessToken = useAuthStore((s) => s.accessToken)

  const handleDelete = async (id: string) => {
    setLoadingId(id)
    try {
      await deleteClient(accessToken, id)
      await onSaved?.()
      setConfirmDeleteId(null)
    } catch (e) {
      // TODO: show error
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Section title="Klienti" count={clients.length}>
      <div className="flex justify-end mb-2">
        <button
          className="text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded border border-green-700"
          onClick={() => setShowCreate(true)}
        >
          Přidat klienta
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500 px-4 py-3">Načítám…</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="px-4 py-2 text-left font-medium">Název</th>
              <th className="px-4 py-2 text-left font-medium">Doména</th>
              <th className="px-4 py-2 text-left font-medium">Akce</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-gray-800/50">
                <td className="px-4 py-2 text-white font-medium">{c.name}</td>
                <td className="px-4 py-2 text-gray-400">{c.domain ?? '—'}</td>
                <td className="px-4 py-2 flex justify-end gap-2">
                  <button
                    className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded border border-blue-700"
                    onClick={() => setEditClient(c)}
                  >
                    Editovat
                  </button>
                  <button
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-700"
                    onClick={() => setConfirmDeleteId(c.id)}
                    disabled={loadingId === c.id}
                  >
                    {loadingId === c.id ? 'Mažu…' : 'Odebrat'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <ClientEditModal client={null} onClose={() => setShowCreate(false)} onSaved={onSaved} />
      )}
      {editClient && (
        <ClientEditModal client={editClient} onClose={() => setEditClient(null)} onSaved={onSaved} />
      )}
      {confirmDeleteId && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 w-80">
            <p className="text-sm text-gray-200 mb-4">Opravdu chcete odebrat tohoto klienta?</p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 text-xs text-gray-300 border border-gray-600 rounded hover:bg-gray-800"
                onClick={() => setConfirmDeleteId(null)}
                disabled={loadingId === confirmDeleteId}
              >
                Zrušit
              </button>
              <button
                className="px-3 py-1 text-xs text-red-400 border border-red-700 rounded hover:bg-red-800"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={loadingId === confirmDeleteId}
              >
                {loadingId === confirmDeleteId ? 'Mažu…' : 'Odebrat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

// ─── Projects section ─────────────────────────────────────────────────────────

import ProjectEditModal from '../components/context/ProjectEditModal'
import { deleteProject } from '../services/deleteClientProjectIssueLink'
import { useAuthStore } from '../store/authStore'

function ProjectsSection({
  projects,
  clients,
  clientMap,
  isLoading,
  onSaved,
}: {
  projects: ProjectDto[]
  clients: ClientDto[]
  clientMap: Map<string, string>
  isLoading: boolean
  onSaved?: () => Promise<void> | void
}) {
  const [editProject, setEditProject] = useState<ProjectDto | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] })
    onSaved?.()
  }

  const handleDelete = async (id: string) => {
    setLoadingId(id)
    try {
      await deleteProject(accessToken, id)
      await onSaved?.()
      setConfirmDeleteId(null)
    } catch (e) {
      // TODO: show error
    } finally {
      setLoadingId(null)
    }
  }


  return (
    <Section title="Projekty" count={projects.length}>
      <div className="flex justify-end mb-2">
        <button
          className="text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded border border-green-700"
          onClick={() => setShowCreate(true)}
        >
          Přidat projekt
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500 px-4 py-3">Načítám…</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="px-4 py-2 text-left font-medium">Název</th>
              <th className="px-4 py-2 text-left font-medium">Jira key</th>
              <th className="px-4 py-2 text-left font-medium">Klient</th>
              <th className="px-4 py-2 text-left font-medium">PM</th>
              <th className="px-4 py-2 text-left font-medium">Aktivní</th>
              <th className="px-4 py-2 text-left font-medium">Akce</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {projects.map((p) => (
              <tr key={p.id} className="hover:bg-gray-800/50">
                <td className="px-4 py-2 text-white font-medium">{p.name}</td>
                <td className="px-4 py-2 font-mono text-yellow-400">{p.jiraProjectKey}</td>
                <td className="px-4 py-2 text-gray-300">
                  {p.clientId ? (clientMap.get(p.clientId) ?? p.clientId) : '—'}
                </td>
                <td className="px-4 py-2 text-gray-400">{p.pmEmail ?? '—'}</td>
                <td className="px-4 py-2">
                  {p.active ? (
                    <span className="text-green-400">✓</span>
                  ) : (
                    <span className="text-gray-600">✕</span>
                  )}
                </td>
                <td className="px-4 py-2 flex justify-end gap-2">
                  <button
                    className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded border border-blue-700"
                    onClick={() => setEditProject(p)}
                  >
                    Editovat
                  </button>
                  <button
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-700"
                    onClick={() => setConfirmDeleteId(p.id)}
                    disabled={loadingId === p.id}
                  >
                    {loadingId === p.id ? 'Mažu…' : 'Odebrat'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create Modal */}
      {showCreate && (
        <ProjectEditModal project={null} clients={clients} onClose={() => setShowCreate(false)} onSaved={handleSaved} />
      )}

      {/* Edit Modal */}
      {editProject && (
        <ProjectEditModal project={editProject} clients={clients} onClose={() => setEditProject(null)} onSaved={handleSaved} />
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 w-80">
            <p className="text-sm text-gray-200 mb-4">Opravdu chcete odebrat tento projekt?</p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 text-xs text-gray-300 border border-gray-600 rounded hover:bg-gray-800"
                onClick={() => setConfirmDeleteId(null)}
                disabled={loadingId === confirmDeleteId}
              >
                Zrušit
              </button>
              <button
                className="px-3 py-1 text-xs text-red-400 border border-red-700 rounded hover:bg-red-800"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={loadingId === confirmDeleteId}
              >
                {loadingId === confirmDeleteId ? 'Mažu…' : 'Odebrat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

// ─── Issues section ───────────────────────────────────────────────────────────

import IssueEditModal from '../components/context/IssueEditModal'
import { deleteIssue } from '../services/deleteClientProjectIssueLink'

function IssuesSection({ issues, isLoading, onSaved }: { issues: JiraIssueDto[]; isLoading: boolean; onSaved?: () => Promise<void> | void }) {
  const [editIssue, setEditIssue] = useState<JiraIssueDto | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const accessToken = undefined // TODO: get from auth store or props

  const handleDelete = async (id: string) => {
    setLoadingId(id)
    try {
      await deleteIssue(accessToken, id)
      await onSaved?.()
      setConfirmDeleteId(null)
    } catch (e) {
      // TODO: show error
    } finally {
      setLoadingId(null)
    }
  }


  return (
    <Section title="Jira Issues (cache)" count={issues.length}>
      <div className="flex justify-end mb-2">
        <button
          className="text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded border border-green-700"
          onClick={() => setShowCreate(true)}
        >
          Přidat issue
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500 px-4 py-3">Načítám…</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="px-4 py-2 text-left font-medium">Issue</th>
              <th className="px-4 py-2 text-left font-medium">Název</th>
              <th className="px-4 py-2 text-left font-medium">Sync</th>
              <th className="px-4 py-2 text-left font-medium">Aktivní</th>
              <th className="px-4 py-2 text-left font-medium">Akce</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {issues.map((i) => (
              <tr key={i.id} className="hover:bg-gray-800/50">
                <td className="px-4 py-2 font-mono text-yellow-400 shrink-0">{i.issueKey}</td>
                <td className="px-4 py-2 text-gray-200 max-w-xs truncate">{i.summary}</td>
                <td className="px-4 py-2 text-gray-500">
                  {i.lastSyncedAt
                    ? new Date(i.lastSyncedAt).toLocaleString('cs-CZ', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </td>
                <td className="px-4 py-2">
                  {i.active ? (
                    <span className="text-green-400">✓</span>
                  ) : (
                    <span className="text-gray-600">✕</span>
                  )}
                </td>
                <td className="px-4 py-2 flex justify-end gap-2">
                  <button
                    className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded border border-blue-700"
                    onClick={() => setEditIssue(i)}
                  >
                    Editovat
                  </button>
                  <button
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-700"
                    onClick={() => setConfirmDeleteId(i.id)}
                    disabled={loadingId === i.id}
                  >
                    {loadingId === i.id ? 'Mažu…' : 'Odebrat'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create Modal */}
      {showCreate && (
        <IssueEditModal issue={null} onClose={() => setShowCreate(false)} onSaved={onSaved} />
      )}

      {/* Edit Modal */}
      {editIssue && (
        <IssueEditModal issue={editIssue} onClose={() => setEditIssue(null)} onSaved={onSaved} />
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 w-80">
            <p className="text-sm text-gray-200 mb-4">Opravdu chcete odebrat toto issue?</p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 text-xs text-gray-300 border border-gray-600 rounded hover:bg-gray-800"
                onClick={() => setConfirmDeleteId(null)}
                disabled={loadingId === confirmDeleteId}
              >
                Zrušit
              </button>
              <button
                className="px-3 py-1 text-xs text-red-400 border border-red-700 rounded hover:bg-red-800"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={loadingId === confirmDeleteId}
              >
                {loadingId === confirmDeleteId ? 'Mažu…' : 'Odebrat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

// ─── Calendar links section ───────────────────────────────────────────────────

import CalendarLinkEditModal from '../components/context/CalendarLinkEditModal'
import { deleteCalendarLink } from '../services/deleteClientProjectIssueLink'

function CalendarLinksSection({
  links,
  isLoading,
  onSaved,
}: {
  links: CalendarIssueLinkDto[]
  isLoading: boolean
  onSaved?: () => Promise<void> | void
}) {
  const [editLink, setEditLink] = useState<CalendarIssueLinkDto | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const accessToken = undefined // TODO: get from auth store or props

  const handleDelete = async (calendarEventId: string) => {
    setLoadingId(calendarEventId)
    try {
      await deleteCalendarLink(accessToken, calendarEventId)
      await onSaved?.()
      setConfirmDeleteId(null)
    } catch (e) {
      // TODO: show error
    } finally {
      setLoadingId(null)
    }
  }


  return (
    <Section title="Vazby událost → Issue" count={links.length}>
      <div className="flex justify-end mb-2">
        <button
          className="text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded border border-green-700"
          onClick={() => setShowCreate(true)}
        >
          Přidat vazbu
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500 px-4 py-3">Načítám…</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="px-4 py-2 text-left font-medium">Událost (Google ID)</th>
              <th className="px-4 py-2 text-left font-medium">Issue</th>
              <th className="px-4 py-2 text-left font-medium">Naposledy změněno</th>
              <th className="px-4 py-2 text-left font-medium">Akce</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {links.map((l) => (
              <tr key={l.id} className="hover:bg-gray-800/50">
                <td className="px-4 py-2 font-mono text-gray-400 max-w-[260px] truncate">
                  {l.calendarEventId}
                </td>
                <td className="px-4 py-2 font-mono text-yellow-400">{l.issueKey}</td>
                <td className="px-4 py-2 text-gray-500">
                  {new Date(l.updatedAt).toLocaleString('cs-CZ', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="px-4 py-2 flex justify-end gap-2">
                  <button
                    className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded border border-blue-700"
                    onClick={() => setEditLink(l)}
                  >
                    Editovat
                  </button>
                  <button
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-700"
                    onClick={() => setConfirmDeleteId(l.calendarEventId)}
                    disabled={loadingId === l.calendarEventId}
                  >
                    {loadingId === l.calendarEventId ? 'Mažu…' : 'Odebrat'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create Modal */}
      {showCreate && (
        <CalendarLinkEditModal link={null} onClose={() => setShowCreate(false)} onSaved={onSaved} />
      )}

      {/* Edit Modal */}
      {editLink && (
        <CalendarLinkEditModal link={editLink} onClose={() => setEditLink(null)} onSaved={onSaved} />
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 w-80">
            <p className="text-sm text-gray-200 mb-4">Opravdu chcete odebrat tuto vazbu?</p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 text-xs text-gray-300 border border-gray-600 rounded hover:bg-gray-800"
                onClick={() => setConfirmDeleteId(null)}
                disabled={loadingId === confirmDeleteId}
              >
                Zrušit
              </button>
              <button
                className="px-3 py-1 text-xs text-red-400 border border-red-700 rounded hover:bg-red-800"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={loadingId === confirmDeleteId}
              >
                {loadingId === confirmDeleteId ? 'Mažu…' : 'Odebrat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}
