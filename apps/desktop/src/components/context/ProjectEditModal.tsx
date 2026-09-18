import React, { useEffect, useState } from 'react'
import type { ProjectDto, ClientDto } from '@houston/shared-types'
import { updateProject } from '../../services/updateProject'
import { createProject } from '../../services/projectsClient'
import { useAuthStore } from '../../store/authStore'

interface ProjectEditModalProps {
  project: ProjectDto | null
  clients: ClientDto[]
  onClose: () => void
  onSaved?: () => void | Promise<void>
}

export default function ProjectEditModal({ project, clients, onClose, onSaved }: ProjectEditModalProps) {
  const [name, setName] = useState(project?.name ?? '')
  const [jiraProjectKey, setJiraProjectKey] = useState(project?.jiraProjectKey ?? '')
  const [pmEmail, setPmEmail] = useState(project?.pmEmail ?? '')
  const [clientId, setClientId] = useState(project?.clientId ?? '')
  const [active, setActive] = useState(project?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const accessToken = useAuthStore((s) => s.accessToken)

  const isEdit = !!project

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const handleSave = async () => {
    setError(null)
    if (!name.trim()) { setError('Název je povinný.'); return }
    setSaving(true)
    try {
      if (isEdit) {
        await updateProject(accessToken, project.id, {
          name,
          jiraProjectKey: jiraProjectKey || null,
          pmEmail: pmEmail || null,
          clientId: clientId || null,
          active,
        })
      } else {
        await createProject(accessToken, {
          name,
          jiraProjectKey: jiraProjectKey || undefined,
          pmEmail: pmEmail || undefined,
          clientId: clientId || undefined,
        })
      }
      await onSaved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Uložení se nezdařilo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 w-96">
        <h3 className="text-lg font-semibold text-white mb-4">{isEdit ? 'Editace projektu' : 'Nový projekt'}</h3>
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Název</label>
          <input
            className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">
            Jira key <span className="text-gray-600">(velká písmena, max 10 znaků, např. PROJ)</span>
          </label>
          <input
            className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700 uppercase"
            value={jiraProjectKey}
            onChange={e => setJiraProjectKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            disabled={saving}
            placeholder="PROJ"
          />
        </div>
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Klient</label>
          <select
            className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            disabled={saving}
          >
            <option value="">— bez klienta —</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">PM Email</label>
          <input
            className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
            value={pmEmail}
            onChange={e => setPmEmail(e.target.value)}
            disabled={saving}
          />
        </div>
        {isEdit && (
          <div className="mb-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={active}
              onChange={e => setActive(e.target.checked)}
              disabled={saving}
              id="active-checkbox"
            />
            <label htmlFor="active-checkbox" className="text-xs text-gray-400">Aktivní</label>
          </div>
        )}
        {error && (
          <p className="mb-3 text-xs text-red-400 bg-red-950 border border-red-800 rounded px-2 py-1">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1 text-xs text-gray-300 border border-gray-600 rounded hover:bg-gray-800"
            onClick={onClose}
            disabled={saving}
          >
            Zrušit
          </button>
          <button
            className="px-3 py-1 text-xs text-blue-400 border border-blue-700 rounded hover:bg-blue-800"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Ukládám…' : isEdit ? 'Uložit' : 'Vytvořit'}
          </button>
        </div>
      </div>
    </div>
  )
}
