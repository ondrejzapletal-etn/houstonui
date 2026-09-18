import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../store/authStore'
import { connectClockifyWithApiKey } from '../../services/connectorsClient'
import { CONNECTORS_QUERY_KEY } from '../../hooks/useConnectors'

interface Props {
  onClose: () => void
}

/**
 * ClockifyOnboardingModal
 *
 * Guides the user through entering a Clockify API key to connect the source.
 * Unlike OAuth connectors (Gmail, Jira, Slack) there is no browser redirect –
 * the API key is submitted directly to the backend which validates it
 * against the Clockify /user endpoint.
 *
 * Clockify API keys can be found at: https://app.clockify.me/user/settings
 */
export default function ClockifyOnboardingModal({ onClose }: Props) {
  const titleId = useId()
  const firstInputRef = useRef<HTMLInputElement>(null)

  const [apiKey, setApiKey] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  // Auto-focus the API key input on mount
  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  // Close on Escape key
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isPending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, isPending])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) {
      setErrorMessage('API key is required.')
      return
    }

    setErrorMessage(null)
    setIsPending(true)

    try {
      await connectClockifyWithApiKey(
        accessToken ?? '',
        apiKey.trim(),
        workspaceId.trim() || undefined,
      )
      setIsSuccess(true)
      // Refresh connector list so the card switches to "connected"
      await queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
      setTimeout(onClose, 800)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Connection failed. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 id={titleId} className="text-base font-semibold text-gray-100">
            Connect Clockify
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded p-1 text-gray-500 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-400 disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4" noValidate>
          {/* Instruction */}
          <p className="text-sm text-gray-400">
            Enter your Clockify API key. You can find it at{' '}
            <span className="text-yellow-400 font-mono text-xs">
              app.clockify.me → Profile Settings → API
            </span>
            .
          </p>

          {/* API key */}
          <div className="flex flex-col gap-1">
            <label htmlFor="clockify-api-key" className="text-xs font-medium text-gray-400">
              API Key <span className="text-red-400">*</span>
            </label>
            <input
              id="clockify-api-key"
              ref={firstInputRef}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Clockify API key"
              disabled={isPending || isSuccess}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 disabled:opacity-50 font-mono"
              aria-describedby="clockify-api-key-hint"
            />
            <span id="clockify-api-key-hint" className="sr-only">
              Your personal Clockify API key from Profile Settings
            </span>
          </div>

          {/* Workspace ID (optional) */}
          <div className="flex flex-col gap-1">
            <label htmlFor="clockify-workspace-id" className="text-xs font-medium text-gray-400">
              Workspace ID{' '}
              <span className="text-gray-600 font-normal">(optional – uses default workspace if empty)</span>
            </label>
            <input
              id="clockify-workspace-id"
              type="text"
              autoComplete="off"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              placeholder="e.g. 64a1b2c3d4e5f60001234567"
              disabled={isPending || isSuccess}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 disabled:opacity-50 font-mono"
            />
            <span className="text-xs text-gray-600">
              Found at: Settings → Workspaces → ID (last segment of the URL)
            </span>
          </div>

          {/* Error */}
          {errorMessage && (
            <p role="alert" className="rounded-md bg-red-900/40 border border-red-700 px-3 py-2 text-sm text-red-300">
              {errorMessage}
            </p>
          )}

          {/* Success */}
          {isSuccess && (
            <p role="status" className="rounded-md bg-green-900/40 border border-green-700 px-3 py-2 text-sm text-green-300">
              ✓ Clockify connected successfully.
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-gray-700 px-4 py-2 text-xs font-semibold text-gray-400 hover:border-gray-500 hover:text-gray-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || isSuccess || !apiKey.trim()}
              className="rounded-md bg-yellow-400 px-4 py-2 text-xs font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Connecting…' : isSuccess ? 'Connected ✓' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
