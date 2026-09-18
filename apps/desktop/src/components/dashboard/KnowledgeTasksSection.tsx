import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useKnowledgeTasks } from '../../hooks/useKnowledge'
import { KnowledgeFact, KnowledgeTaskSummary } from '../../services/knowledgeClient'
import AddWorklogModal from './AddWorklogModal'

const MAX_VISIBLE = 5

function getIssueKey(facts: KnowledgeFact[]): string | null {
  const f = facts.find((f) => f.key === 'jiraIssueKey' || f.key === 'issueKey')
  return f ? String(f.value) : null
}

function getProjectName(task: KnowledgeTaskSummary): string | null {
  const rel = task.outgoingRelations.find((r) => r.relationType === 'PART_OF' && r.toEntity.type === 'project')
  return rel?.toEntity.title ?? null
}

function getLastActivity(task: KnowledgeTaskSummary) {
  const obs = task.observations[0]
  if (obs) {
    return { date: obs.observedAt, source: obs.sourceSystem, summary: obs.content ?? '' }
  }
  const jiraUpdated = task.facts.find((f) => f.key === 'jiraUpdatedAt')
  if (jiraUpdated) {
    return { date: String(jiraUpdated.value), source: 'jira', summary: '' }
  }
  return { date: task.updatedAt, source: 'system', summary: '' }
}

function formatActivityDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

export default function KnowledgeTasksSection() {
  const { data: tasks, isLoading, isError } = useKnowledgeTasks()
  const [worklogTask, setWorklogTask] = useState<{ issueKey: string | null } | null>(null)

  const today = new Date().toISOString().substring(0, 10)
  const visible = tasks?.slice(0, MAX_VISIBLE) ?? []

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className="mt-2 text-l font-semibold uppercase">Úkoly</h3>
        <Link
          to="/knowledge?tab=entities&type=task"
          className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          Všechny úkoly →
        </Link>
      </div>

      {isError && (
        <p className="text-sm text-red-400">Nepodařilo se načíst úkoly z knowledge base.</p>
      )}

      {!isLoading && !isError && (!tasks || tasks.length === 0) && (
        <p className="text-sm text-gray-500">Žádné aktivní úkoly v knowledge base.</p>
      )}

      <div className="grid grid-cols-5 gap-3">
        {isLoading &&
          Array.from({ length: MAX_VISIBLE }).map((_, i) => (
            <div key={i} className="card p-3 animate-pulse space-y-2">
              <div className="h-3 bg-gray-700 rounded w-1/2" />
              <div className="h-3.5 bg-gray-700 rounded w-4/5" />
              <div className="h-2.5 bg-gray-800 rounded w-3/5 mt-2" />
              <div className="h-7 bg-gray-700 rounded-lg mt-3" />
            </div>
          ))}

        {!isLoading &&
          visible.map((task) => {
            const issueKey = getIssueKey(task.facts)
            const activity = getLastActivity(task)
            const projectName = getProjectName(task)
            return (
              <div key={task.id} className="card p-3 flex flex-col gap-2">
                <div className="flex-1 min-h-0">
                  <p className="text-sm text-gray-100 font-medium leading-snug">
                    {truncate(task.title, 80)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 leading-snug">
                    {formatActivityDate(activity.date)} · {activity.source}
                    {activity.summary && (
                      <> · <span className="italic">{truncate(activity.summary, 50)}</span></>
                    )}
                  </p>
                </div>
                <div className='flex justify-between'>
                  <p className="text-xs text-gray-400 mt-0.5 font-mono">
                      {issueKey ?? '—'}
                      {projectName && <span className="font-sans text-gray-500"> · {projectName}</span>}
                  </p>
                  <button
                    onClick={() => setWorklogTask({ issueKey })}
                    className="button-action local small transition-colors"
                  >
                    <img src="/img/ico-time.webp" alt="" className="w-4 h-4" />
                    Vykaž
                  </button>
                </div>
              </div>
            )
          })}
      </div>

      {worklogTask && (
        <AddWorklogModal
          defaultDate={today}
          defaultIssueKey={worklogTask.issueKey ?? undefined}
          onClose={() => setWorklogTask(null)}
        />
      )}
    </div>
  )
}
