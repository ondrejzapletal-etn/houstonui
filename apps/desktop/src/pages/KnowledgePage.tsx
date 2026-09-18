import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import AppLayout from '../components/layout/AppLayout'
import {
  useKnowledgeEntities,
  useKnowledgeEntity,
  useKnowledgeObservations,
  useKnowledgeEvents,
} from '../hooks/useKnowledge'
import { syncKnowledgeDomainData, enrichTasksFromJira } from '../services/knowledgeClient'
import { useAuthStore } from '../store/authStore'
import type {
  KnowledgeEntity,
  KnowledgeFact,
  KnowledgeDerivedState,
  KnowledgeObservation,
  KnowledgeEvent,
} from '../services/knowledgeClient'

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: 'Osoba',
  task: 'Úkol',
  project: 'Projekt',
  conversation: 'Konverzace',
  artifact: 'Artefakt',
  organization: 'Organizace',
}

const TYPE_COLORS: Record<string, string> = {
  person: 'text-blue-400 bg-blue-950 border-blue-800',
  task: 'text-yellow-400 bg-yellow-950 border-yellow-800',
  project: 'text-indigo-400 bg-indigo-950 border-indigo-800',
  conversation: 'text-green-400 bg-green-950 border-green-800',
  artifact: 'text-purple-400 bg-purple-950 border-purple-800',
  organization: 'text-orange-400 bg-orange-950 border-orange-800',
}

const SOURCE_COLORS: Record<string, string> = {
  gmail: 'text-red-400',
  slack: 'text-purple-400',
  calendar: 'text-blue-400',
  jira: 'text-yellow-400',
  clockify: 'text-green-400',
}

const ALL_TYPES = ['person', 'task', 'project', 'conversation', 'artifact', 'organization']

type Tab = 'observations' | 'entities'

export default function KnowledgePage() {
  const [tab, setTab] = useState<Tab>(() => {
    const p = new URLSearchParams(window.location.search)
    return (p.get('tab') as Tab) ?? 'observations'
  })
  const [selectedType, setSelectedType] = useState<string | undefined>(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('type') ?? undefined
  })
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  const { data: entities = [], isLoading: entitiesLoading, isError: entitiesError } = useKnowledgeEntities(selectedType)
  const { data: observations = [], isLoading: obsLoading, isError: obsError } = useKnowledgeObservations()

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const r = await syncKnowledgeDomainData(accessToken)
      setSyncResult(`Synchronizováno: ${r.clients} klientů, ${r.projects} projektů, ${r.issues} issues`)
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] })
    } catch {
      setSyncResult('Synchronizace selhala')
    } finally {
      setSyncing(false)
    }
  }

  const handleEnrichTasks = async () => {
    setEnriching(true)
    setSyncResult(null)
    try {
      const r = await enrichTasksFromJira(accessToken)
      setSyncResult(`Obohaceno ${r.enriched} úkolů z Jira`)
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] })
    } catch {
      setSyncResult('Obohacení selhalo')
    } finally {
      setEnriching(false)
    }
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Knowledge</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Trvale uložená pozorování, entity a vztahy vytvořené během scanů a synchronizace pracovních dat. Aplikace je používá jako kontext při vyhodnocení scanu a odpovědích asistenta.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing || enriching}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-50 transition-colors"
            >
              {syncing ? 'Synchronizuji…' : 'Sync DB → KG'}
            </button>
            <button
              onClick={handleEnrichTasks}
              disabled={syncing || enriching}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-50 transition-colors"
            >
              {enriching ? 'Obohacuji…' : 'Obohatit úkoly z Jira'}
            </button>
          <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
            <TabButton active={tab === 'observations'} onClick={() => setTab('observations')}>
              Pozorování
              {observations.length > 0 && (
                <span className="ml-1.5 text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full">
                  {observations.length}
                </span>
              )}
            </TabButton>
            <TabButton active={tab === 'entities'} onClick={() => setTab('entities')}>
              Entity
              {entities.length > 0 && (
                <span className="ml-1.5 text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full">
                  {entities.length}
                </span>
              )}
            </TabButton>
          </div>
          </div>
        </div>

        {syncResult && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-gray-900 border border-gray-700 text-xs text-gray-300">
            {syncResult}
          </div>
        )}

        {/* ── Observations tab ── */}
        {tab === 'observations' && (
          <ObservationsView
            observations={observations}
            isLoading={obsLoading}
            isError={obsError}
          />
        )}

        {/* ── Entities tab ── */}
        {tab === 'entities' && (
          <EntitiesView
            entities={entities}
            isLoading={entitiesLoading}
            isError={entitiesError}
            selectedType={selectedType}
            onTypeChange={setSelectedType}
            selectedEntityId={selectedEntityId}
            onEntitySelect={setSelectedEntityId}
          />
        )}
      </div>
    </AppLayout>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center',
        active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ─── Observations view ────────────────────────────────────────────────────────

function ObservationsView({
  observations,
  isLoading,
  isError,
}: {
  observations: KnowledgeObservation[]
  isLoading: boolean
  isError: boolean
}) {
  if (isLoading) return <Skeleton />
  if (isError) return <ErrorBox />
  if (observations.length === 0) {
    return (
      <EmptyState message="Žádná pozorování. Spusťte scan — data se zapíší automaticky." />
    )
  }

  // Group by sourceSystem
  const bySource = observations.reduce<Record<string, KnowledgeObservation[]>>((acc, o) => {
    ;(acc[o.sourceSystem] ??= []).push(o)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(bySource).map(([source, items]) => (
        <div key={source} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${SOURCE_COLORS[source] ?? 'text-gray-300'}`}>
                {source}
              </span>
              <span className="text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded-full">
                {items.length}
              </span>
            </div>
          </div>
          <ul className="divide-y divide-gray-800">
            {items.map((o) => (
              <li key={o.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-gray-500">{o.sourceType}</span>
                      <span className="text-xs font-mono text-gray-600 truncate max-w-[200px]">
                        {o.sourceRef}
                      </span>
                      <span
                        className={[
                          'text-xs px-1.5 py-0.5 rounded-full',
                          o.processed
                            ? 'bg-green-950 text-green-400'
                            : 'bg-yellow-950 text-yellow-500',
                        ].join(' ')}
                      >
                        {o.processed ? 'zpracováno' : 'čeká'}
                      </span>
                    </div>
                    {o.content && (
                      <p className="text-sm text-gray-200 line-clamp-2">{o.content}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-600 shrink-0">
                    {new Date(o.observedAt).toLocaleString('cs-CZ', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// ─── Entities view ────────────────────────────────────────────────────────────

function EntitiesView({
  entities,
  isLoading,
  isError,
  selectedType,
  onTypeChange,
  selectedEntityId,
  onEntitySelect,
}: {
  entities: KnowledgeEntity[]
  isLoading: boolean
  isError: boolean
  selectedType: string | undefined
  onTypeChange: (t: string | undefined) => void
  selectedEntityId: string | null
  onEntitySelect: (id: string | null) => void
}) {
  return (
    <>
      {/* Type filter */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <FilterChip active={selectedType === undefined} onClick={() => onTypeChange(undefined)}>
          Vše
        </FilterChip>
        {ALL_TYPES.map((t) => (
          <FilterChip
            key={t}
            active={selectedType === t}
            colorClass={selectedType === t ? TYPE_COLORS[t] : undefined}
            onClick={() => onTypeChange(selectedType === t ? undefined : t)}
          >
            {ENTITY_TYPE_LABELS[t] ?? t}
          </FilterChip>
        ))}
      </div>

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          {isLoading && <Skeleton />}
          {isError && <ErrorBox />}
          {!isLoading && !isError && entities.length === 0 && (
            <EmptyState message="Žádné entity. Entity vznikají z pozorování po zpracování." />
          )}
          {!isLoading && entities.length > 0 && (
            <div className="space-y-2">
              {entities.map((e) => (
                <EntityRow
                  key={e.id}
                  entity={e}
                  isSelected={selectedEntityId === e.id}
                  onClick={() => onEntitySelect(selectedEntityId === e.id ? null : e.id)}
                />
              ))}
            </div>
          )}
        </div>

        {selectedEntityId && (
          <div className="w-96 shrink-0">
            <EntityDetail id={selectedEntityId} onClose={() => onEntitySelect(null)} />
          </div>
        )}
      </div>
    </>
  )
}

function FilterChip({
  active,
  colorClass,
  onClick,
  children,
}: {
  active: boolean
  colorClass?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
        active
          ? (colorClass ?? 'bg-gray-700 border-gray-600 text-white')
          : 'bg-transparent border-gray-700 text-gray-400 hover:text-white hover:border-gray-500',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ─── Entity row ───────────────────────────────────────────────────────────────

function EntityRow({
  entity,
  isSelected,
  onClick,
}: {
  entity: KnowledgeEntity
  isSelected: boolean
  onClick: () => void
}) {
  const colorClass = TYPE_COLORS[entity.type] ?? 'text-gray-400 bg-gray-800 border-gray-700'

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left px-4 py-3 rounded-lg border transition-colors',
        isSelected
          ? 'bg-gray-800 border-gray-600'
          : 'bg-gray-900 border-gray-800 hover:bg-gray-800/60',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={['text-xs font-medium px-2 py-0.5 rounded-full border', colorClass].join(' ')}>
              {ENTITY_TYPE_LABELS[entity.type] ?? entity.type}
            </span>
            {entity.status && <span className="text-xs text-gray-500">{entity.status}</span>}
          </div>
          <p className="text-sm font-medium text-white truncate">{entity.title}</p>
          {entity.description && (
            <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{entity.description}</p>
          )}
        </div>
        <span className="text-xs text-gray-600 shrink-0 pt-0.5">
          {new Date(entity.updatedAt).toLocaleDateString('cs-CZ')}
        </span>
      </div>
    </button>
  )
}

// ─── Entity detail panel ──────────────────────────────────────────────────────

function EntityDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'facts' | 'observations' | 'events'>('facts')
  const { data, isLoading } = useKnowledgeEntity(id)
  const { data: observations = [] } = useKnowledgeObservations(activeTab === 'observations' ? id : undefined)
  const { data: events = [] } = useKnowledgeEvents(activeTab === 'events' ? id : undefined)

  const colorClass = data ? (TYPE_COLORS[data.type] ?? 'text-gray-400 bg-gray-800 border-gray-700') : ''

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden sticky top-8">
      <div className="px-4 py-3 border-b border-gray-800 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {data && (
            <span className={['text-xs font-medium px-2 py-0.5 rounded-full border mb-1 inline-block', colorClass].join(' ')}>
              {ENTITY_TYPE_LABELS[data.type] ?? data.type}
            </span>
          )}
          {isLoading ? (
            <div className="h-5 w-40 bg-gray-800 rounded animate-pulse mt-1" />
          ) : (
            <p className="text-sm font-semibold text-white truncate">{data?.title}</p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors shrink-0 text-lg leading-none">×</button>
      </div>

      {data?.description && (
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-400">{data.description}</p>
        </div>
      )}

      {data && data.externalLinks.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-800 flex flex-wrap gap-1">
          {data.externalLinks.map((l) => (
            <span key={l.id} className="text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded-full">
              {l.sourceSystem}/{l.sourceType}: {l.sourceRef}
            </span>
          ))}
        </div>
      )}

      <div className="flex border-b border-gray-800">
        {(['facts', 'observations', 'events'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={[
              'flex-1 px-3 py-2 text-xs font-medium transition-colors',
              activeTab === t ? 'text-white border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300',
            ].join(' ')}
          >
            {t === 'facts' ? 'Fakta' : t === 'observations' ? 'Pozorování' : 'Události'}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto max-h-[60vh]">
        {isLoading && <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-gray-800 rounded animate-pulse" />)}</div>}
        {!isLoading && activeTab === 'facts' && data && <FactsTab facts={data.facts} derived={data.derivedState} />}
        {activeTab === 'observations' && <ObservationsList observations={observations} />}
        {activeTab === 'events' && <EventsList events={events} />}
      </div>
    </div>
  )
}

// ─── Facts tab ────────────────────────────────────────────────────────────────

function FactsTab({ facts, derived }: { facts: KnowledgeFact[]; derived: KnowledgeDerivedState | null }) {
  return (
    <div className="divide-y divide-gray-800">
      {derived && !derived.invalidated && (
        <div className="px-4 py-3 bg-indigo-950/30">
          <p className="text-xs font-semibold text-indigo-400 mb-1">AI shrnutí</p>
          {derived.summary && <p className="text-xs text-gray-300 mb-2">{derived.summary}</p>}
          {derived.insights && derived.insights.length > 0 && (
            <ul className="space-y-0.5">{derived.insights.map((ins, i) => <li key={i} className="text-xs text-gray-400">• {ins}</li>)}</ul>
          )}
          <div className="flex gap-3 mt-2">
            {derived.urgencyScore != null && <span className="text-xs text-yellow-400">Urgence: {Math.round(derived.urgencyScore * 100)}%</span>}
            {derived.riskScore != null && <span className="text-xs text-red-400">Riziko: {Math.round(derived.riskScore * 100)}%</span>}
          </div>
        </div>
      )}
      {facts.length === 0 && <p className="px-4 py-4 text-xs text-gray-500">Žádná fakta.</p>}
      {facts.map((f) => (
        <div key={f.id} className="px-4 py-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-300">{f.key}</p>
            <p className="text-xs text-gray-500 break-all">{typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-600">{Math.round(f.confidence * 100)}%</p>
            {f.source && <p className="text-xs text-gray-700">{f.source}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function ObservationsList({ observations }: { observations: KnowledgeObservation[] }) {
  if (observations.length === 0) return <p className="px-4 py-4 text-xs text-gray-500">Žádná pozorování.</p>
  return (
    <ul className="divide-y divide-gray-800">
      {observations.map((o) => (
        <li key={o.id} className="px-4 py-3">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-xs font-medium ${SOURCE_COLORS[o.sourceSystem] ?? 'text-gray-400'}`}>{o.sourceSystem}</span>
            <span className="text-xs text-gray-600">{o.sourceType}</span>
            <span className={['text-xs px-1.5 py-0.5 rounded-full', o.processed ? 'bg-green-950 text-green-400' : 'bg-yellow-950 text-yellow-400'].join(' ')}>{o.processed ? 'zprac.' : 'čeká'}</span>
          </div>
          {o.content && <p className="text-xs text-gray-300 line-clamp-2">{o.content}</p>}
          <p className="text-xs text-gray-600 mt-0.5">{new Date(o.observedAt).toLocaleString('cs-CZ')}</p>
        </li>
      ))}
    </ul>
  )
}

function EventsList({ events }: { events: KnowledgeEvent[] }) {
  if (events.length === 0) return <p className="px-4 py-4 text-xs text-gray-500">Žádné události.</p>
  return (
    <ul className="divide-y divide-gray-800">
      {events.map((e) => (
        <li key={e.id} className="px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-300">{e.eventType}</span>
            <span className="text-xs text-gray-600">{new Date(e.createdAt).toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {Object.keys(e.payload).length > 0 && <p className="text-xs text-gray-600 mt-0.5 font-mono break-all">{JSON.stringify(e.payload)}</p>}
        </li>
      ))}
    </ul>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-gray-900 rounded-lg animate-pulse" />)}
    </div>
  )
}

function ErrorBox() {
  return (
    <div className="bg-red-950 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
      Nepodařilo se načíst data.
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center text-gray-500 text-sm">
      {message}
    </div>
  )
}
