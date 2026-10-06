import { useState } from 'react'
import { useConnectors, CONNECTORS_QUERY_KEY } from '../../hooks/useConnectors'
import { useQueryClient } from '@tanstack/react-query'
import { refreshConnectorUnread } from '../../services/connectorsClient'
import type { ConnectorInfo, ConnectorType } from '@houston/shared-types'
import { API_BASE_URL } from '../../config/api'
import { useAuthStore } from '../../store/authStore'
import ClockifyOnboardingModal from './ClockifyOnboardingModal'
import SourceSetupModal from './SourceSetupModal'
import SourcePreviewModal from './SourcePreviewModal'
import gmailIcon from '../img/gmail.webp'
import slackIcon from '../img/slack.webp'
import jiraIcon from '../img/jira.webp'
import clockifyIcon from '../img/clockify.webp'
import calendarIcon from '../img/google-cal.webp'

const CONNECTOR_ICONS: Partial<Record<ConnectorType, string>> = {
  gmail: gmailIcon,
  slack: slackIcon,
  jira: jiraIcon,
  clockify: clockifyIcon,
  hotspot: '/img/hot-spot-cropped.webp',
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 p-4 animate-pulse"
      aria-hidden="true"
    >
      <div className="h-4 w-24 rounded bg-gray-600" />
      <div className="h-6 w-10 rounded-full bg-gray-600" />
    </div>
  )
}

interface ConnectorCardProps {
  connector: ConnectorInfo
  onRefresh: (type: ConnectorType) => void
  onConnect: (type: ConnectorType) => void
  onDisconnect: (type: ConnectorType) => void
  onOpenPreview: (type: ConnectorType) => void
  isConnecting: boolean
  isDisconnecting: boolean
  showRefreshButton: boolean
}

import { useRef, useState as useLocalState } from 'react'

function ConnectorCard(props: ConnectorCardProps) {
  const { connector, onRefresh, onConnect, onDisconnect, onOpenPreview, isConnecting, isDisconnecting, showRefreshButton } = props
  const { id, label, status, unreadCount, lastCheckedAt, errorMessage } = connector
  const icon = CONNECTOR_ICONS[id]
  const tooltipId = `connector-${id}-message`
  // Pokud je gmail, zobrazíme i kalendářovou ikonu
  const isGmail = id === 'gmail';
  const isUsable = status === 'connected' || status === 'warning';
  const showsUnreadIndicator = isUsable && unreadCount !== null && (id === 'gmail' || id === 'slack')
  const showsConnectedIndicator = isUsable && (id === 'jira' || id === 'clockify')

  const formattedTime = lastCheckedAt
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
        new Date(lastCheckedAt),
      )
    : null;

  // Dropdown menu for actions
  const [menuOpen, setMenuOpen] = useLocalState(false);
  const [isTooltipVisible, setIsTooltipVisible] = useLocalState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  function handleMenuToggle() {
    setMenuOpen((v) => !v);
  }

  function handleMenuBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Close menu if focus leaves the menu
    if (
      !e.currentTarget.contains(e.relatedTarget) &&
      !menuButtonRef.current?.contains(e.relatedTarget as Node)
    ) {
      setMenuOpen(false);
    }
  }

  function handleCardBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsTooltipVisible(false)
    }
  }

  function handleCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    onOpenPreview(id)
  }

  return (
    <div
      className="card flex min-w-[180px] max-w-[250px] cursor-pointer flex-col gap-2 rounded-lg border border-gray-700 bg-gray-800 p-4 relative transition-colors hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
      role="button"
      tabIndex={0}
      aria-label={`Otevřít náhled ${label}`}
      aria-describedby={errorMessage ? tooltipId : undefined}
      data-testid={`source-card-${id}`}
      onClick={() => onOpenPreview(id)}
      onKeyDown={handleCardKeyDown}
      onMouseEnter={() => setIsTooltipVisible(true)}
      onMouseLeave={() => setIsTooltipVisible(false)}
      onFocusCapture={() => setIsTooltipVisible(true)}
      onBlurCapture={handleCardBlur}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Gmail + Calendar icons vedle sebe */}
          {isGmail ? (
            <>
              <img src={gmailIcon} alt="Gmail" aria-hidden="true" className="h-4 w-4 object-contain" />
              <img src={calendarIcon} alt="Google Kalendář" aria-hidden="true" className="h-4 w-4 object-contain" />
            </>
          ) : (
            icon && <img src={icon} alt="" aria-hidden="true" className="h-4 w-4 object-contain" />
          )}
          <span className="relative flex items-center font-medium text-gray-100">
            {label}
            {status === 'warning' ? (
              <svg
                className="ml-2 h-3.5 w-3.5 shrink-0 text-amber-500"
                viewBox="0 0 24 24"
                role="img"
                aria-label="Varování"
                data-testid="warning-status-indicator"
              >
                <path fill="currentColor" d="M12 3 2 21h20L12 3Z" />
                <path fill="black" d="M11 9h2v6h-2zm0 8h2v2h-2z" />
              </svg>
            ) : null}
          </span>
        </div>

        {showsUnreadIndicator && (
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-full border border-green-600 bg-green-400 px-1 text-xs font-bold text-gray-900"
            role="status"
            title={`${unreadCount} unread`}
            data-testid={`unread-indicator-${id}`}
          >
            <span className="sr-only">{unreadCount} unread</span>
            <span aria-hidden="true">{unreadCount}</span>
          </span>
        )}

        {showsConnectedIndicator && (
          <span
            className="h-3 w-3 rounded-full border border-green-600 bg-green-400"
            role="status"
            aria-label="Connected"
            data-testid={`connected-indicator-${id}`}
          />
        )}

        {status === 'not_connected' && <span className="text-xs text-gray-400">Not connected</span>}

        {status === 'token_expired' && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-amber-900 border border-amber-700">
            Re-authorise
          </span>
        )}

        {status === 'error' && (
          <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white border border-red-700">
            Error
          </span>
        )}

        {/* Dropdown menu button for connected sources */}
        {isUsable && (showRefreshButton || true) && (
          <div
            className="relative"
            data-source-menu="true"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              ref={menuButtonRef}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Actions"
              className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              onClick={handleMenuToggle}
            >
              <span className="sr-only">Actions</span>
              <svg width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="4" r="1.5" fill="currentColor" />
                <circle cx="10" cy="10" r="1.5" fill="currentColor" />
                <circle cx="10" cy="16" r="1.5" fill="currentColor" />
              </svg>
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 z-10 mt-2 w-36 rounded-md bg-gray-900 border border-gray-700 shadow-lg focus:outline-none"
                tabIndex={-1}
                onBlur={handleMenuBlur}
              >
                <ul className="py-1">
                  {/* Last updated info in dropdown */}
                  {formattedTime && (
                    <li>
                      <span className="block px-4 py-2 text-xs text-gray-500 cursor-default select-none">
                        Last updated {formattedTime}
                      </span>
                    </li>
                  )}
                  {showRefreshButton && (
                    <li>
                      <button
                        type="button"
                        onClick={() => { onRefresh(id); setMenuOpen(false); }}
                        className="w-full text-left px-4 py-2 text-xs text-green-400 hover:bg-gray-800 hover:text-green-300 focus:bg-gray-800 focus:text-green-300"
                        aria-label={`Refresh ${label} unread count`}
                      >
                        Refresh
                      </button>
                    </li>
                  )}
                  <li>
                    <button
                      type="button"
                      onClick={() => { onDisconnect(id); setMenuOpen(false); }}
                      disabled={isDisconnecting}
                      className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-gray-800 hover:text-red-300 focus:bg-gray-800 focus:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={`Disconnect ${label}`}
                    >
                      {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info row */}
      {status === 'token_expired' && (
          <span className="text-xs text-amber-600">
            Token expired – reconnect this account to restore access.
          </span>
        )}

      {/* Connect / Disconnect actions */}
      {(status === 'not_connected' || status === 'token_expired' || status === 'error') ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onConnect(id)
            }}
            disabled={isConnecting}
            className="button-action source transition-colors"
            aria-label={`Connect ${label}`}
          >
            {isConnecting
              ? 'Opening browser…'
              : status === 'token_expired' || status === 'error'
                ? 'Reconnect'
                : 'Connect'}
          </button>
        </div>
      ) : null}

      {errorMessage ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 top-0 z-20 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-md border border-gray-600 bg-gray-950 px-3 py-2 text-xs text-gray-100 shadow-lg transition-opacity ${
            isTooltipVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}

// ─── Dev-only Gmail connect button ───────────────────────────────────────────

const IS_DEV = import.meta.env.DEV

type DevConnectStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; url: string }
  | { kind: 'error'; message: string }

/**
 * [DEV ONLY] Tlačítko pro rychlé testování Gmail OAuth flow. Zobrazuje se vždy
 * v development buildu – NESMÍ být součástí produkčního UI.
 *
 * V production buildu je tlačítko skryté a místo něj se zobrazí výrazné
 * varování, aby bylo jasné, že komponenta nebyla odstraněna před releasem.
 *
 * Vyžaduje přihlášení: /connectors/:type/connect je autentizovaný endpoint.
 */
function GmailDevConnectButton() {
  const [status, setStatus] = useState<DevConnectStatus>({ kind: 'idle' })
  const queryClient = useQueryClient()
  const accessToken = useAuthStore((s) => s.accessToken)

  if (!IS_DEV) {
    return (
      <div
        role="alert"
        aria-label="Production build warning"
        className="rounded-md border-2 border-red-500 bg-red-950 px-4 py-3 text-sm text-red-300"
      >
        <p className="font-bold text-red-400">
          ⛔ PRODUKČNÍ BUILD: GmailDevConnectButton je přítomna ve PRODUCTION kódu.
        </p>
        <p className="mt-1 text-xs text-red-500">
          Tato komponenta je určena výhradně pro vývoj. Odstraňte ji před nasazením do produkce.
        </p>
      </div>
    )
  }

  async function handleConnect() {
    setStatus({ kind: 'loading' })
    try {
      const res = await fetch(`${API_BASE_URL}/connectors/gmail/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken ?? ''}`,
        },
      })

      if (!res.ok) {
        const text = await res.text().catch(() => String(res.status))
        setStatus({ kind: 'error', message: `Server vrátil ${res.status}: ${text}` })
        return
      }

      const json: unknown = await res.json()
      const authUrl =
        typeof json === 'object' && json !== null
          ? (((json as Record<string, unknown>).authUrl as string | undefined) ??
            ((json as Record<string, unknown>).url as string | undefined))
          : undefined

      if (typeof authUrl !== 'string' || authUrl.length === 0) {
        setStatus({ kind: 'error', message: 'Server nevrátil platné pole authUrl.' })
        return
      }

      window.open(authUrl, '_blank', 'noopener,noreferrer')
      setStatus({ kind: 'success', url: authUrl })
      // After OAuth completes, refresh connector list then fetch live unread count.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
        void refreshConnectorUnread(accessToken ?? '', 'gmail').then((updated) => {
          queryClient.setQueryData(
            CONNECTORS_QUERY_KEY,
            (prev: { connectors: ConnectorInfo[] } | undefined) => {
              if (!prev) return prev
              return { connectors: prev.connectors.map((c) => (c.id === 'gmail' ? updated : c)) }
            },
          )
        }).catch(() => undefined)
      }, 3000)
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Síťová chyba – zkontroluj backend.',
      })
    }
  }

  return (
    <div
      className="rounded-md border border-dashed border-yellow-600 bg-yellow-950/40 p-3"
      data-testid="gmail-dev-connect"
    >
      {/* Dev-mode badge */}
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-yellow-500">
        ⚠️ Testovací / vývojové chování – nezobrazuje se v produkci
      </p>

      <button
        type="button"
        onClick={handleConnect}
        disabled={status.kind === 'loading'}
        aria-label="Připojit Gmail (dev)"
        className="rounded-md bg-yellow-500 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {status.kind === 'loading' ? 'Otevírám prohlížeč…' : 'Připojit Gmail'}
      </button>

      {status.kind === 'success' && (
        <p className="mt-2 text-xs text-yellow-300">
          ✓ Okno prohlížeče otevřeno pro Gmail OAuth.{' '}
          <span className="text-yellow-500">
            (DEV flow – žádný přihlašovací token není vyžadován)
          </span>
        </p>
      )}

      {status.kind === 'error' && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          Chyba: {status.message}
        </p>
      )}
    </div>
  )
}

// ─── Dev-only Jira connect button ────────────────────────────────────────────

/**
 * [DEV ONLY] Tlačítko pro rychlé testování Jira OAuth flow bez nutnosti
 * být přihlášen. Zobrazuje se vždy v development buildu – NESMÍ být součástí
 * produkčního UI.
 */
function JiraDevConnectButton() {
  const [status, setStatus] = useState<DevConnectStatus>({ kind: 'idle' })
  const queryClient = useQueryClient()

  if (!IS_DEV) {
    return (
      <div
        role="alert"
        aria-label="Production build warning"
        className="rounded-md border-2 border-red-500 bg-red-950 px-4 py-3 text-sm text-red-300"
      >
        <p className="font-bold text-red-400">
          ⛔ PRODUKČNÍ BUILD: JiraDevConnectButton je přítomna ve PRODUCTION kódu.
        </p>
        <p className="mt-1 text-xs text-red-500">
          Tato komponenta je určena výhradně pro vývoj. Odstraňte ji před nasazením do produkce.
        </p>
      </div>
    )
  }

  async function handleConnect() {
    setStatus({ kind: 'loading' })
    try {
      const res = await fetch(`${API_BASE_URL}/connectors/jira/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const text = await res.text().catch(() => String(res.status))
        setStatus({ kind: 'error', message: `Server vrátil ${res.status}: ${text}` })
        return
      }

      const json: unknown = await res.json()
      const authUrl =
        typeof json === 'object' && json !== null
          ? (((json as Record<string, unknown>).authUrl as string | undefined) ??
            ((json as Record<string, unknown>).url as string | undefined))
          : undefined

      if (typeof authUrl !== 'string' || authUrl.length === 0) {
        setStatus({ kind: 'error', message: 'Server nevrátil platné pole authUrl.' })
        return
      }

      window.open(authUrl, '_blank', 'noopener,noreferrer')
      setStatus({ kind: 'success', url: authUrl })
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
      }, 3000)
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Síťová chyba – zkontroluj backend.',
      })
    }
  }

  return (
    <div
      className="rounded-md border border-dashed border-blue-600 bg-blue-950/40 p-3"
      data-testid="jira-dev-connect"
    >
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-blue-500">
        ⚠️ Testovací / vývojové chování – nezobrazuje se v produkci
      </p>

      <button
        type="button"
        onClick={handleConnect}
        disabled={status.kind === 'loading'}
        aria-label="Připojit Jira (dev)"
        className="rounded-md bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {status.kind === 'loading' ? 'Otevírám prohlížeč…' : 'Připojit Jira'}
      </button>

      {status.kind === 'success' && (
        <p className="mt-2 text-xs text-blue-300">
          ✓ Okno prohlížeče otevřeno pro Jira OAuth.{' '}
          <span className="text-blue-500">
            (DEV flow – žádný přihlašovací token není vyžadován)
          </span>
        </p>
      )}

      {status.kind === 'error' && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          Chyba: {status.message}
        </p>
      )}
    </div>
  )
}

// ─── Dev-only Slack connect button ──────────────────────────────────────────

/**
 * [DEV ONLY] Tlačítko pro rychlé testování Slack OAuth flow bez nutnosti
 * být přihlášen. Zobrazuje se vždy v development buildu – NESMÍ být součástí
 * produkčního UI.
 */
function SlackDevConnectButton() {
  const [status, setStatus] = useState<DevConnectStatus>({ kind: 'idle' })
  const queryClient = useQueryClient()

  if (!IS_DEV) {
    return (
      <div
        role="alert"
        aria-label="Production build warning"
        className="rounded-md border-2 border-red-500 bg-red-950 px-4 py-3 text-sm text-red-300"
      >
        <p className="font-bold text-red-400">
          ⛔ PRODUKČNÍ BUILD: SlackDevConnectButton je přítomna ve PRODUCTION kódu.
        </p>
        <p className="mt-1 text-xs text-red-500">
          Tato komponenta je určena výhradně pro vývoj. Odstraňte ji před nasazením do produkce.
        </p>
      </div>
    )
  }

  async function handleConnect() {
    setStatus({ kind: 'loading' })
    try {
      const res = await fetch(`${API_BASE_URL}/connectors/slack/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const text = await res.text().catch(() => String(res.status))
        setStatus({ kind: 'error', message: `Server vrátil ${res.status}: ${text}` })
        return
      }

      const json: unknown = await res.json()
      const authUrl =
        typeof json === 'object' && json !== null
          ? (((json as Record<string, unknown>).authUrl as string | undefined) ??
            ((json as Record<string, unknown>).url as string | undefined))
          : undefined

      if (typeof authUrl !== 'string' || authUrl.length === 0) {
        setStatus({ kind: 'error', message: 'Server nevrátil platné pole authUrl.' })
        return
      }

      window.open(authUrl, '_blank', 'noopener,noreferrer')
      setStatus({ kind: 'success', url: authUrl })
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
      }, 3000)
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Síťová chyba – zkontroluj backend.',
      })
    }
  }

  return (
    <div
      className="rounded-md border border-dashed border-purple-600 bg-purple-950/40 p-3"
      data-testid="slack-dev-connect"
    >
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-purple-500">
        ⚠️ Testovací / vývojové chování – nezobrazuje se v produkci
      </p>

      <button
        type="button"
        onClick={handleConnect}
        disabled={status.kind === 'loading'}
        aria-label="Připojit Slack (dev)"
        className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {status.kind === 'loading' ? 'Otevírám prohlížeč…' : 'Připojit Slack'}
      </button>

      {status.kind === 'success' && (
        <p className="mt-2 text-xs text-purple-300">
          ✓ Okno prohlížeče otevřeno pro Slack OAuth.{' '}
          <span className="text-purple-500">
            (DEV flow – žádný přihlašovací token není vyžadován)
          </span>
        </p>
      )}

      {status.kind === 'error' && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          Chyba: {status.message}
        </p>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SourcesSection() {
  const {
    connectors,
    isLoading,
    isError,
    errorMessage,
    refetch,
    refreshOne,
    isRefreshing,
    connect,
    disconnect,
    connectingType,
    disconnectingType,
    connectError,
    disconnectError,
  } = useConnectors()

  const [showInfo, setShowInfo] = useState(false)
  const [showDev, setShowDev] = useState(false)
  const [showAddSource, setShowAddSource] = useState(false)
  const [isClockifyModalOpen, setIsClockifyModalOpen] = useState(false)
  const [isSourceSetupOpen, setIsSourceSetupOpen] = useState(false)
  const [previewType, setPreviewType] = useState<ConnectorType | null>(null)

  const previewConnector = connectors.find((c) => c.id === previewType) ?? null

  /** Intercept connect for Clockify: open API key modal instead of OAuth browser flow */
  function handleConnect(type: ConnectorType) {
    if (type === 'clockify') {
      setIsClockifyModalOpen(true)
    } else {
      connect(type)
    }
  }

  return (
    <section aria-labelledby="sources-heading">
      <div className="p-2">
        {/* Heading + global refresh */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h2
              id="sources-heading"
              className="text-lg font-bold uppercase tracking-wide"
            >
              Zdroje
            </h2>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowInfo((v) => !v)}
                aria-label="Security and privacy information"
                aria-expanded={showInfo}
                aria-describedby={showInfo ? 'sources-security-tooltip' : undefined}
                className="flex h-4 w-4 items-center justify-center rounded-full border border-blue-700 text-[10px] font-bold text-blue-400 hover:border-blue-400 hover:text-blue-200 focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors"
              >
                i
              </button>
              {showInfo && (
                <div
                  id="sources-security-tooltip"
                  role="tooltip"
                  className="absolute left-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-blue-800/40 bg-blue-900 px-4 py-3 shadow-lg"
                >
                  <p className="text-xs leading-relaxed text-blue-100">
                    <strong className="font-semibold">Your credentials stay on the server.</strong>{' '}
                    After you authorise a provider in your browser, the backend stores access and
                    refresh tokens in Azure Key Vault. The desktop app receives only connection
                    status; PostgreSQL stores metadata and a reference to the secret, never token
                    values.
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddSource((v) => !v)}
              className="button-action local transition-colors"
              aria-label="Přidat source"
              aria-expanded={showAddSource}
              aria-controls="add-source-panel"
            >
              + Přidat source
            </button>
            <button
              type="button"
              onClick={() => setIsSourceSetupOpen(true)}
              className="button-action local transition-colors"
              aria-label="Nastavení zdrojů"
            >
              Nastavení zdrojů
            </button>
            <button
              type="button"
              onClick={() => setShowDev((v) => !v)}
              className="rounded border border-dashed border-yellow-600 bg-yellow-950/40 px-3 py-1.5 text-xs font-semibold text-yellow-400 hover:bg-yellow-900 focus:outline-none focus:ring-1 focus:ring-yellow-400 transition-colors"
              aria-expanded={showDev}
              aria-controls="dev-connections-section"
              style={{ marginRight: 0 }}
            >
              {showDev ? 'Hide dev connections' : 'Dev connections'}
            </button>
            <button
              type="button"
              onClick={refetch}
              disabled={isLoading || isRefreshing}
              className="text-sm text-gray-400 hover:text-gray-200 disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-yellow-400 rounded"
              aria-label="Refresh all connector statuses"
              aria-disabled={isLoading || isRefreshing}
            >
              {isRefreshing ? 'Refreshing…' : 'Refresh all'}
            </button>
          </div>
        </div>

        {/* Action error feedback */}
        {(connectError ?? disconnectError) && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400"
          >
            {connectError ?? disconnectError}
          </div>
        )}

        {/* Live region so screen readers announce count updates */}
        <div aria-live="polite" aria-atomic="false" className="sr-only">
          {!isLoading &&
            connectors
              .filter((c) => c.status === 'connected')
              .map((c) => `${c.label}: ${c.unreadCount ?? 0} unread`)
              .join(', ')}
        </div>

        {/* Content */}
        <div className="flex flex-row items-start gap-3" aria-busy={isLoading || isRefreshing}>
          {isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : isError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-800 bg-red-950 p-4 text-sm text-red-300"
            >
              <p className="font-semibold">Could not load connector status.</p>
              {errorMessage && <p className="mt-1 text-red-400">{errorMessage}</p>}
              <button
                type="button"
                onClick={refetch}
                className="mt-2 text-xs text-red-300 underline hover:text-red-100 focus:outline-none focus:ring-1 focus:ring-red-400 rounded"
              >
                Try again
              </button>
            </div>
          ) : connectors.length === 0 ? (
            <p className="text-sm text-gray-500">No connectors configured.</p>
          ) : (
            connectors
              .filter((c) => c.status === 'connected' || c.status === 'warning' || c.status === 'error' || c.status === 'token_expired')
              .map((connector) => (
                <ConnectorCard
                  key={connector.id}
                  connector={connector}
                  onRefresh={refreshOne}
                  onConnect={handleConnect}
                  onDisconnect={disconnect}
                  onOpenPreview={setPreviewType}
                  isConnecting={connectingType === connector.id}
                  isDisconnecting={disconnectingType === connector.id}
                  showRefreshButton={connector.id !== 'jira' && connector.id !== 'clockify'}
                />
              ))
          )}
        </div>

        {/* Add source panel – non-connected connectors */}
        {showAddSource && !isLoading && !isError && (
          <div id="add-source-panel" className="mt-3 flex flex-row flex-wrap gap-3">
            {connectors.filter((c) => c.status === 'not_connected').length === 0 ? (
              <p className="text-sm text-gray-500">Všechny zdroje jsou připojeny.</p>
            ) : (
              connectors
                .filter((c) => c.status === 'not_connected')
                .map((connector) => (
                  <ConnectorCard
                    key={connector.id}
                    connector={connector}
                    onRefresh={refreshOne}
                    onConnect={handleConnect}
                    onDisconnect={disconnect}
                    onOpenPreview={setPreviewType}
                    isConnecting={connectingType === connector.id}
                    isDisconnecting={disconnectingType === connector.id}
                    showRefreshButton={false}
                  />
                ))
            )}
          </div>
        )}

        {/* Dev-only connect buttons – hidden by default, toggled by button in heading */}
        {showDev && (
          <div id="dev-connections-section" className="mt-4 flex flex-col gap-2">
            <GmailDevConnectButton />
            <SlackDevConnectButton />
            <JiraDevConnectButton />
            {/* Clockify uses API key auth – opens the onboarding modal directly */}
            <div
              className="rounded-md border border-dashed border-emerald-600 bg-emerald-950/40 p-3"
              data-testid="clockify-dev-connect"
            >
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                ⚠️ Testovací / vývojové chování – nezobrazuje se v produkci
              </p>
              <button
                type="button"
                onClick={() => setIsClockifyModalOpen(true)}
                aria-label="Připojit Clockify (dev)"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
              >
                Připojit Clockify
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Clockify onboarding modal – triggered instead of OAuth redirect */}
      {isClockifyModalOpen && (
        <ClockifyOnboardingModal onClose={() => setIsClockifyModalOpen(false)} />
      )}

      {/* Per-source setup wizard modal */}
      {isSourceSetupOpen && (
        <SourceSetupModal onClose={() => setIsSourceSetupOpen(false)} />
      )}

      {/* Per-source content preview modal */}
      {previewConnector && (
        <SourcePreviewModal
          connector={previewConnector}
          onClose={() => setPreviewType(null)}
        />
      )}
    </section>
  )
}
