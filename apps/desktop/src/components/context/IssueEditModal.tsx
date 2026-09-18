import React, { useEffect, useState } from 'react'
import type { JiraIssueDto } from '@houston/shared-types'
import { updateIssue } from '../../services/updateIssue'
import { upsertIssue } from '../../services/projectsClient'

interface IssueEditModalProps {
  issue: JiraIssueDto | null
  onClose: () => void
  onSaved?: () => void | Promise<void>
  onCreate?: (values: { issueKey: string; summary: string; projectId?: string; active: boolean }) => void
}

export default function IssueEditModal({ issue, onClose, onSaved, onCreate }: IssueEditModalProps) {
  const [issueKey, setIssueKey] = useState(issue?.issueKey ?? '')
  const [summary, setSummary] = useState(issue?.summary ?? '')
  const [active, setActive] = useState(issue?.active ?? true)
  const [saving, setSaving] = useState(false)
  const accessToken = undefined

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const isEdit = !!issue

  const handleSave = async () => {
    setSaving(true)
    try {
      if (isEdit) {
        await updateIssue(accessToken, issue.id, { summary, active })
        await onSaved?.()
        onClose()
      } else if (onCreate) {
        await onCreate({ issueKey, summary, active })
      } else {
        await upsertIssue(accessToken, { issueKey, summary, active })
        await onSaved?.()
        onClose()
      }
    } catch (e) {
      // TODO: show error
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 w-96">
        <h3 className="text-lg font-semibold text-white mb-4">{isEdit ? 'Editace issue' : 'Nové issue'}</h3>
        {!isEdit && (
          <div className="mb-3">
            <label className="block text-xs text-gray-400 mb-1">Issue Key</label>
            <input
              className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
              value={issueKey}
              onChange={e => setIssueKey(e.target.value)}
              disabled={saving}
            />
          </div>
        )}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Název</label>
          <input
            className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
            value={summary}
            onChange={e => setSummary(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="mb-4 flex items-center gap-2">
          <input
            type="checkbox"
            checked={active}
            onChange={e => setActive(e.target.checked)}
            disabled={saving}
            id="active-checkbox-issue"
          />
          <label htmlFor="active-checkbox-issue" className="text-xs text-gray-400">Aktivní</label>
        </div>
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
