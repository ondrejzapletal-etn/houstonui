import React, { useEffect, useState } from 'react'
import type { CalendarIssueLinkDto } from '@houston/shared-types'
import { updateCalendarLink } from '../../services/updateCalendarLink'
import { upsertCalendarLink } from '../../services/projectsClient'

interface CalendarLinkEditModalProps {
  link: CalendarIssueLinkDto | null
  onClose: () => void
  onSaved?: () => void | Promise<void>
  onCreate?: (values: { calendarEventId: string; issueKey: string; notes?: string }) => void
}

export default function CalendarLinkEditModal({ link, onClose, onSaved, onCreate }: CalendarLinkEditModalProps) {
  const [calendarEventId, setCalendarEventId] = useState(link?.calendarEventId ?? '')
  const [issueKey, setIssueKey] = useState(link?.issueKey ?? '')
  const [notes, setNotes] = useState(link?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const accessToken = undefined

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const isEdit = !!link

  const handleSave = async () => {
    setSaving(true)
    try {
      if (isEdit) {
        await updateCalendarLink(accessToken, link.calendarEventId, { issueKey, notes })
        await onSaved?.()
        onClose()
      } else if (onCreate) {
        await onCreate({ calendarEventId, issueKey, notes })
      } else {
        await createCalendarLink(accessToken, { calendarEventId, issueKey, notes })
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
        <h3 className="text-lg font-semibold text-white mb-4">{isEdit ? 'Editace vazby událost-Issue' : 'Nová vazba událost-Issue'}</h3>
        {!isEdit && (
          <div className="mb-3">
            <label className="block text-xs text-gray-400 mb-1">Google Event ID</label>
            <input
              className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
              value={calendarEventId}
              onChange={e => setCalendarEventId(e.target.value)}
              disabled={saving}
            />
          </div>
        )}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Jira Issue Key</label>
          <input
            className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
            value={issueKey}
            onChange={e => setIssueKey(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">Poznámka</label>
          <input
            className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={saving}
          />
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
