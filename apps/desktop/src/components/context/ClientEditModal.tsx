
import React, { useEffect, useState } from 'react'
import type { ClientDto } from '@houston/shared-types'
import { updateClient } from '../../services/updateClient'
import { createClient } from '../../services/projectsClient'
import { useAuthStore } from '../../store/authStore'

interface ClientEditModalProps {
  client: ClientDto | null
  onClose: () => void
  onSaved?: () => void | Promise<void>
}

export default function ClientEditModal({ client, onClose, onSaved }: ClientEditModalProps) {
  const [name, setName] = useState(client?.name ?? '')
  const [domain, setDomain] = useState(client?.domain ?? '')
  const [saving, setSaving] = useState(false)
  const accessToken = useAuthStore((s) => s.accessToken)
  const isEdit = !!client

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const handleSave = async () => {
    setSaving(true)
    try {
      if (isEdit) {
        await updateClient(accessToken, client.id, { name, domain })
      } else {
        await createClient(accessToken, { name, domain })
      }
      await onSaved?.()
      onClose()
    } catch (e) {
      // TODO: show error
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 w-96">
        <h3 className="text-lg font-semibold text-white mb-4">{isEdit ? 'Editace klienta' : 'Nový klient'}</h3>
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Název</label>
          <input
            className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">Doména</label>
          <input
            className="w-full px-2 py-1 rounded bg-gray-800 text-white border border-gray-700"
            value={domain}
            onChange={e => setDomain(e.target.value)}
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
