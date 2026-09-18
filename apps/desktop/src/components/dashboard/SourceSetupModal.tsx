import { useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnectors, CONNECTORS_QUERY_KEY } from '../../hooks/useConnectors'
import { connectClockifyWithApiKey, connectHotSpot } from '../../services/connectorsClient'
import { useAuthStore } from '../../store/authStore'
import type { ConnectorInfo, ConnectorType } from '@houston/shared-types'
import { API_BASE_URL } from '../../config/api'
import gmailIcon from '../img/gmail.webp'
import slackIcon from '../img/slack.webp'
import jiraIcon from '../img/jira.webp'
import clockifyIcon from '../img/clockify.webp'
import hotSpotIcon from '../img/calendar.webp'

// ─── Types ────────────────────────────────────────────────────────────────────

type SourceId = 'gmail' | 'slack' | 'jira' | 'clockify' | 'hotspot'

interface SourceMeta {
  id: SourceId
  label: string
  description: string
}

const SOURCE_ICONS: Record<SourceId, string> = {
  gmail: gmailIcon,
  slack: slackIcon,
  jira: jiraIcon,
  clockify: clockifyIcon,
  hotspot: hotSpotIcon,
}

const SOURCES: SourceMeta[] = [
  {
    id: 'gmail',
    label: 'Google',
    description: 'Nepřečtené e-maily z Gmailu a události z Google Kalendáře.',
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Nepřečtené zprávy z DM a kanálů ve vašem Slack workspace.',
  },
  {
    id: 'jira',
    label: 'Jira',
    description: 'Worklogy a přiřazené úkoly z Atlassian Jira.',
  },
  {
    id: 'clockify',
    label: 'Clockify',
    description: 'Záznamy odpracovaného času z vašeho Clockify účtu.',
  },
  {
    id: 'hotspot',
    label: 'Hot Spot',
    description: 'Dovolená z plánování kapacit HOT SPOT.',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(info: ConnectorInfo | undefined): string {
  if (!info) return 'Nepřipojeno'
  switch (info.status) {
    case 'connected':
      return 'Připojeno'
    case 'token_expired':
      return 'Token vypršel – znovu připojte'
    case 'error':
      return 'Chyba'
    default:
      return 'Nepřipojeno'
  }
}

function statusDot(info: ConnectorInfo | undefined): string {
  if (!info || info.status === 'not_connected') return 'bg-gray-600'
  if (info.status === 'connected') return 'bg-green-500'
  if (info.status === 'token_expired') return 'bg-amber-500'
  return 'bg-red-500'
}

// ─── Source list (main view) ──────────────────────────────────────────────────

interface SourceListProps {
  connectors: ConnectorInfo[]
  onSelect: (id: SourceId) => void
  onClose: () => void
}

function SourceList({ connectors, onSelect, onClose }: SourceListProps) {
  const byId = new Map(connectors.map((c) => [c.id, c]))

  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <h2 className="text-base font-semibold text-gray-100">Nastavení zdrojů</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-400"
          aria-label="Zavřít"
        >
          ✕
        </button>
      </div>
      <div className="px-6 py-5 flex flex-col gap-3">
        {SOURCES.map((src) => {
          const info = byId.get(src.id)
          return (
            <button
              key={src.id}
              type="button"
              onClick={() => onSelect(src.id)}
              className="flex items-center gap-4 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-left hover:border-yellow-500/50 hover:bg-gray-750 focus:outline-none focus:ring-1 focus:ring-yellow-400 transition-colors group"
            >
              <img src={SOURCE_ICONS[src.id]} alt="" aria-hidden="true" className="h-6 w-6 object-contain shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-100">{src.label}</span>
                  <span className={`h-2 w-2 rounded-full shrink-0 ${statusDot(info)}`} aria-hidden="true" />
                  <span className="text-xs text-gray-500">{statusLabel(info)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{src.description}</p>
              </div>
              <span className="text-gray-600 group-hover:text-gray-400 transition-colors text-sm shrink-0">›</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

// ─── OAuth source wizard ──────────────────────────────────────────────────────

interface OAuthSourceWizardProps {
  source: SourceMeta
  info: ConnectorInfo | undefined
  onBack: () => void
  connect: (type: ConnectorType) => void
  disconnect: (type: ConnectorType) => void
  connectingType: ConnectorType | null
  disconnectingType: ConnectorType | null
  connectError: string | null
  disconnectError: string | null
}

function OAuthSourceWizard({
  source,
  info,
  onBack,
  connect,
  disconnect,
  connectingType,
  disconnectingType,
  connectError,
  disconnectError,
}: OAuthSourceWizardProps) {
  const [isWaiting, setIsWaiting] = useState(false)
  const queryClient = useQueryClient()

  const isConnecting = connectingType === source.id
  const isDisconnecting = disconnectingType === source.id
  const isConnected = info?.status === 'connected'

  // Start waiting animation when connect is triggered
  useEffect(() => {
    if (isConnecting) setIsWaiting(true)
  }, [isConnecting])

  // Once connected, stop waiting
  useEffect(() => {
    if (isConnected) setIsWaiting(false)
  }, [isConnected])

  // Poll while waiting for OAuth completion
  useEffect(() => {
    if (!isWaiting) return
    const id = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
    }, 3000)
    return () => clearInterval(id)
  }, [isWaiting, queryClient])

  return (
    <>
      <div className="flex items-center gap-3 border-b border-gray-800 px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1 text-gray-500 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-400"
          aria-label="Zpět"
        >
          ‹
        </button>
        <img src={SOURCE_ICONS[source.id]} alt="" aria-hidden="true" className="h-6 w-6 object-contain shrink-0" />
        <h2 className="text-base font-semibold text-gray-100 flex-1">{source.label}</h2>
        <span className={`h-2 w-2 rounded-full ${statusDot(info)}`} aria-hidden="true" />
        <span className="text-xs text-gray-500">{statusLabel(info)}</span>
      </div>

      <div className="px-6 py-5 flex flex-col gap-4">
        <p className="text-sm text-gray-400">{source.description}</p>

        {/* Security note */}
        <div className="rounded-lg border border-blue-800/40 bg-blue-900/20 px-4 py-3">
          <p className="text-xs text-blue-300 leading-relaxed">
            <span className="font-semibold">Tokeny zůstávají na serveru.</span> Do desktopové
            aplikace se nikdy nedostanou. Kliknutím se otevře prohlížeč, kde udělíte oprávnění přímo
            poskytovateli.
          </p>
        </div>

        {/* Per-source setup instructions */}
        <SetupInstructions sourceId={source.id} />

        {/* Error feedback */}
        {(connectError ?? disconnectError) && (
          <div role="alert" className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400">
            {connectError ?? disconnectError}
          </div>
        )}

        {/* Waiting for OAuth */}
        {isWaiting && !isConnected && (
          <div className="flex items-center gap-3 rounded-lg border border-yellow-800/40 bg-yellow-900/20 px-4 py-3">
            <svg className="h-4 w-4 animate-spin text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <p className="text-xs text-yellow-300">Čeká se na dokončení autorizace v prohlížeči…</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-1">
          {isConnected ? (
            <button
              type="button"
              onClick={() => disconnect(source.id as ConnectorType)}
              disabled={isDisconnecting}
              className="w-full rounded-lg border border-gray-600 px-4 py-2.5 text-sm font-semibold text-gray-400 hover:border-red-500 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              {isDisconnecting ? 'Odpojování…' : 'Odpojit'}
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                if (source.id === 'slack') {
                  setIsWaiting(true)
                  try {
                    const url = await initiateSlackConnectDev()
                    window.open(url, '_blank', 'noopener')
                  } catch (err) {
                    console.error('Slack dev connect failed', err)
                  }
                } else {
                  connect(source.id as ConnectorType)
                  setIsWaiting(true)
                }
              }}
              disabled={isConnecting || isWaiting}
              className="w-full rounded-lg bg-yellow-400 px-4 py-2.5 text-sm font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              {isConnecting || isWaiting ? 'Otevírám prohlížeč…' : info?.status === 'token_expired' ? 'Znovu připojit' : 'Připojit'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Setup instructions per source ───────────────────────────────────────────

function SetupInstructions({ sourceId }: { sourceId: SourceId }) {
  switch (sourceId) {
    case 'gmail':
      return (
        <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 px-4 py-3 space-y-2">
          <p className="text-xs text-gray-400 font-semibold">Potřebujete Google OAuth app:</p>
          <ol className="text-xs text-gray-400 leading-relaxed list-decimal list-inside space-y-1">
            <li>Google Cloud Console → APIs &amp; Services → Credentials</li>
            <li>Create Credentials → OAuth 2.0 Client ID (Web application)</li>
            <li>Povolte Gmail API a Google Calendar API v sekci Library</li>
            <li>
              Callback URL:{' '}
              <code className="bg-gray-700 px-1 rounded text-[10px]">
                http://localhost:3000/api/v1/connectors/gmail/callback
              </code>
            </li>
            <li>
              Client ID + Secret nastavte v{' '}
              <code className="bg-gray-700 px-1 rounded text-[10px]">apps/backend/.env</code>
            </li>
          </ol>
        </div>
      )

    case 'slack':
      return (
        <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 px-4 py-3 space-y-2">
          <p className="text-xs text-gray-400 font-semibold">Potřebujete Slack OAuth app:</p>
          <ol className="text-xs text-gray-400 leading-relaxed list-decimal list-inside space-y-1">
            <li>
              Otevřete{' '}
              <code className="bg-gray-700 px-1 rounded text-[10px]">api.slack.com/apps</code>{' '}
              → Create New App → From scratch
            </li>
            <li>OAuth &amp; Permissions → User Token Scopes</li>
            <li>
              Přidejte scopes:{' '}
              {['im:read', 'mpim:read', 'channels:read', 'groups:read', 'users:read'].map((s) => (
                <code key={s} className="bg-gray-700 px-1 rounded text-[10px] mr-1">
                  {s}
                </code>
              ))}
            </li>
            <li>
              Redirect URL:{' '}
              <code className="bg-gray-700 px-1 rounded text-[10px]">
                http://localhost:3000/api/v1/connectors/slack/callback
              </code>
            </li>
            <li>
              Client ID + Secret nastavte v{' '}
              <code className="bg-gray-700 px-1 rounded text-[10px]">apps/backend/.env</code>{' '}
              jako <code className="bg-gray-700 px-1 rounded text-[10px]">SLACK_CLIENT_ID</code>{' '}
              a <code className="bg-gray-700 px-1 rounded text-[10px]">SLACK_CLIENT_SECRET</code>
            </li>
          </ol>
        </div>
      )

    case 'jira':
      return (
        <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 px-4 py-3 space-y-2">
          <p className="text-xs text-gray-400 font-semibold">Potřebujete Atlassian OAuth app:</p>
          <ol className="text-xs text-gray-400 leading-relaxed list-decimal list-inside space-y-1">
            <li>
              <code className="bg-gray-700 px-1 rounded text-[10px]">developer.atlassian.com/console/myapps</code>{' '}
              → Create → OAuth 2.0 (3LO)
            </li>
            <li>
              Permissions:{' '}
              {['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'].map((s) => (
                <code key={s} className="bg-gray-700 px-1 rounded text-[10px] mr-1">
                  {s}
                </code>
              ))}
            </li>
            <li>
              Callback URL:{' '}
              <code className="bg-gray-700 px-1 rounded text-[10px]">
                http://localhost:3000/api/v1/connectors/jira/callback
              </code>
            </li>
            <li>
              Client ID + Secret nastavte v{' '}
              <code className="bg-gray-700 px-1 rounded text-[10px]">apps/backend/.env</code>
            </li>
          </ol>
        </div>
      )

    case 'clockify':
      // Clockify uses its own modal (ClockifyOnboardingModal) – not OAuth
      return null
  }
}

// ─── Clockify source wizard ───────────────────────────────────────────────────

interface ClockifyWizardProps {
  source: SourceMeta
  info: ConnectorInfo | undefined
  onBack: () => void
  disconnect: (type: ConnectorType) => void
  disconnectingType: ConnectorType | null
  disconnectError: string | null
}

function ClockifyWizard({
  source,
  info,
  onBack,
  disconnect,
  disconnectingType,
  disconnectError,
}: ClockifyWizardProps) {
  const titleId = useId()
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  const [apiKey, setApiKey] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSuccess, setIsSuccess] = useState(false)

  const isConnected = info?.status === 'connected'
  const isDisconnecting = disconnectingType === 'clockify'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) {
      setError('API key je povinný.')
      return
    }
    setError(null)
    setIsPending(true)
    try {
      await connectClockifyWithApiKey(accessToken ?? '', apiKey.trim(), workspaceId.trim() || undefined)
      setIsSuccess(true)
      await queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Připojení selhalo. Zkuste to znovu.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-gray-800 px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1 text-gray-500 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-400"
          aria-label="Zpět"
        >
          ‹
        </button>
        <img src={SOURCE_ICONS[source.id]} alt="" aria-hidden="true" className="h-6 w-6 object-contain shrink-0" />
        <h2 id={titleId} className="text-base font-semibold text-gray-100 flex-1">{source.label}</h2>
        <span className={`h-2 w-2 rounded-full ${statusDot(info)}`} aria-hidden="true" />
        <span className="text-xs text-gray-500">{statusLabel(info)}</span>
      </div>

      <div className="px-6 py-5 flex flex-col gap-4">
        <p className="text-sm text-gray-400">{source.description}</p>

        {isConnected ? (
          <>
            <div className="rounded-lg border border-green-800/40 bg-green-900/20 px-4 py-3">
              <p className="text-xs text-green-300">Clockify je připojen.</p>
            </div>
            {disconnectError && (
              <div role="alert" className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400">
                {disconnectError}
              </div>
            )}
            <button
              type="button"
              onClick={() => disconnect('clockify')}
              disabled={isDisconnecting}
              className="w-full rounded-lg border border-gray-600 px-4 py-2.5 text-sm font-semibold text-gray-400 hover:border-red-500 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              {isDisconnecting ? 'Odpojování…' : 'Odpojit'}
            </button>
          </>
        ) : isSuccess ? (
          <div className="rounded-lg border border-green-800/40 bg-green-900/20 px-4 py-3">
            <p className="text-xs text-green-300">✓ Clockify úspěšně připojen.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 px-4 py-3">
              <p className="text-xs text-gray-400">
                API key najdete na{' '}
                <code className="bg-gray-700 px-1 rounded text-[10px]">app.clockify.me</code>{' '}
                → Profile Settings → API.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="setup-clockify-api-key" className="text-xs font-medium text-gray-400">
                API Key <span className="text-red-400">*</span>
              </label>
              <input
                id="setup-clockify-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="setup-clockify-workspace" className="text-xs font-medium text-gray-400">
                Workspace ID <span className="text-gray-600">(volitelné)</span>
              </label>
              <input
                id="setup-clockify-workspace"
                type="text"
                autoComplete="off"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                placeholder="Nechte prázdné pro výchozí workspace"
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
              />
            </div>

            {error && (
              <div role="alert" className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-lg bg-yellow-400 px-4 py-2.5 text-sm font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              {isPending ? 'Připojuji…' : 'Připojit Clockify'}
            </button>
          </form>
        )}
      </div>
    </>
  )
}

interface HotSpotWizardProps {
  source: SourceMeta
  info: ConnectorInfo | undefined
  onBack: () => void
  disconnect: (type: ConnectorType) => void
  disconnectingType: ConnectorType | null
  disconnectError: string | null
}

function HotSpotWizard({
  source,
  info,
  onBack,
  disconnect,
  disconnectingType,
  disconnectError,
}: HotSpotWizardProps) {
  const accessToken = useAuthStore((state) => state.accessToken)
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isConnected = info?.status === 'connected'

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!apiKey.trim() || !employeeId.trim()) {
      setError('API key a Employee ID jsou povinné.')
      return
    }
    setError(null)
    setIsPending(true)
    try {
      await connectHotSpot(accessToken ?? '', apiKey.trim(), employeeId.trim())
      setApiKey('')
      await queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Připojení selhalo.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-gray-800 px-6 py-4">
        <button type="button" onClick={onBack} className="rounded p-1 text-gray-500 hover:text-gray-200" aria-label="Zpět">‹</button>
        <img src={SOURCE_ICONS.hotspot} alt="" aria-hidden="true" className="h-6 w-6 object-contain" />
        <h2 className="text-base font-semibold text-gray-100 flex-1">{source.label}</h2>
        <span className={`h-2 w-2 rounded-full ${statusDot(info)}`} aria-hidden="true" />
        <span className="text-xs text-gray-500">{statusLabel(info)}</span>
      </div>
      <div className="px-6 py-5 flex flex-col gap-4">
        <p className="text-sm text-gray-400">{source.description}</p>
        {isConnected ? (
          <>
            <div className="rounded-lg border border-green-800/40 bg-green-900/20 px-4 py-3 text-xs text-green-300">
              HOT SPOT je připojen.
            </div>
            {disconnectError && <div role="alert" className="text-xs text-red-400">{disconnectError}</div>}
            <button
              type="button"
              onClick={() => disconnect('hotspot')}
              disabled={disconnectingType === 'hotspot'}
              className="w-full rounded-lg border border-gray-600 px-4 py-2.5 text-sm font-semibold text-gray-400 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
            >
              {disconnectingType === 'hotspot' ? 'Odpojování…' : 'Odpojit'}
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <p className="rounded-lg border border-gray-700/50 bg-gray-800/50 px-4 py-3 text-xs text-gray-400">
              Klíč vytvoříte v HOT SPOT: Account → New API key. Employee ID má tvar například ETNC693HPP.
            </p>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-400">
              API key
              <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-400">
              Employee ID
              <input type="text" autoComplete="off" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} placeholder="ETNC693HPP" className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100" />
            </label>
            {error && <div role="alert" className="text-xs text-red-400">{error}</div>}
            <button type="submit" disabled={isPending} className="w-full rounded-lg bg-yellow-400 px-4 py-2.5 text-sm font-semibold text-gray-900 disabled:opacity-50">
              {isPending ? 'Připojuji…' : 'Připojit HOT SPOT'}
            </button>
          </form>
        )}
      </div>
    </>
  )
}

// ─── Dev-only Slack connect via direct fetch ──────────────────────────────────

/**
 * Dev-only: initiates Slack OAuth directly without the useConnectors hook
 * (which requires a valid ConnectorType). Used inside the setup modal for
 * the "Připojit" button when the normal connect() hook flow doesn't cover Slack.
 */
async function initiateSlackConnectDev(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/connectors/slack/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status))
    throw new Error(`Server vrátil ${res.status}: ${text}`)
  }
  const json: unknown = await res.json()
  const authUrl =
    typeof json === 'object' && json !== null
      ? (((json as Record<string, unknown>).authUrl as string | undefined) ??
          ((json as Record<string, unknown>).url as string | undefined))
      : undefined
  if (typeof authUrl !== 'string' || authUrl.length === 0) {
    throw new Error('Server nevrátil platné pole authUrl.')
  }
  return authUrl
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export default function SourceSetupModal({ onClose }: Props) {
  const [selectedSource, setSelectedSource] = useState<SourceId | null>(null)

  const {
    connectors,
    connect,
    disconnect,
    connectingType,
    disconnectingType,
    connectError,
    disconnectError,
  } = useConnectors()

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (selectedSource !== null) {
          setSelectedSource(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, selectedSource])

  const source = SOURCES.find((s) => s.id === selectedSource) ?? null
  const info = connectors.find((c) => c.id === selectedSource) ?? undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Nastavení zdrojů"
    >
      <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 shadow-2xl mx-4 max-h-[90vh] overflow-y-auto">
        {selectedSource === null ? (
          <SourceList connectors={connectors} onSelect={setSelectedSource} onClose={onClose} />
        ) : source?.id === 'clockify' ? (
          <ClockifyWizard
            source={source}
            info={info}
            onBack={() => setSelectedSource(null)}
            disconnect={disconnect}
            disconnectingType={disconnectingType}
            disconnectError={disconnectError}
          />
        ) : source?.id === 'hotspot' ? (
          <HotSpotWizard
            source={source}
            info={info}
            onBack={() => setSelectedSource(null)}
            disconnect={disconnect}
            disconnectingType={disconnectingType}
            disconnectError={disconnectError}
          />
        ) : source !== null ? (
          <OAuthSourceWizard
            source={source}
            info={info}
            onBack={() => setSelectedSource(null)}
            connect={connect}
            disconnect={disconnect}
            connectingType={connectingType}
            disconnectingType={disconnectingType}
            connectError={connectError}
            disconnectError={disconnectError}
          />
        ) : null}
      </div>
    </div>
  )
}
