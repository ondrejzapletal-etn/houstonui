import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  ConnectorInfo,
  SourcePreviewEmail,
  SourcePreviewSlackChannel,
} from '@houston/shared-types'
import { CONNECTOR_WEB_URLS } from '../../config/connectorLinks'
import { CONNECTORS_QUERY_KEY } from '../../hooks/useConnectors'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useAuthStore } from '../../store/authStore'
import {
  markGmailPreviewRead,
  markSlackPreviewRead,
} from '../../services/sourcePreviewClient'
import {
  useSourcePreview,
  type SourcePreviewData,
  type SourcePreviewWorklogEntry,
} from '../../hooks/useSourcePreview'
import gmailIcon from '../img/gmail.webp'
import slackIcon from '../img/slack.webp'
import jiraIcon from '../img/jira.webp'
import clockifyIcon from '../img/clockify.webp'

const SOURCE_ICONS: Record<string, string> = {
  gmail: gmailIcon,
  slack: slackIcon,
  jira: jiraIcon,
  clockify: clockifyIcon,
  hotspot: '/img/hot-spot-cropped.webp',
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function slackTimestampToIso(timestamp: string): string {
  const seconds = Number(timestamp)
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : ''
}

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

// ─── Per-source bodies ────────────────────────────────────────────────────────

interface MarkReadState {
  markingIds: Set<string>
  readIds: Set<string>
  errors: Record<string, string>
}

function MessageIndicators({
  isUnread,
  hasResponded,
  isAddressedToUser,
}: {
  isUnread: boolean
  hasResponded: boolean
  isAddressedToUser: boolean
}) {
  const indicators = [
    { active: !hasResponded, label: hasResponded ? 'Reagováno' : 'Bez reakce' },
    { active: isUnread, label: isUnread ? 'Nepřečteno' : 'Přečteno' },
    { active: isAddressedToUser, label: isAddressedToUser ? 'Addressed to you' : 'In copy only' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Stav zprávy">
      {indicators.map(({ active, label }) => (
        <span key={label} className={`inline-flex items-center gap-1.5 text-xs ${active ? 'text-orange-300' : 'text-gray-500'}`}>
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${active ? 'bg-orange-500' : 'bg-gray-600'}`}
          />
          {label}
        </span>
      ))}
    </div>
  )
}

function EmailList({
  emails,
  markReadState,
  onMarkRead,
}: {
  emails: SourcePreviewEmail[]
  markReadState: MarkReadState
  onMarkRead: (messageId: string) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <ul className="divide-y divide-gray-800">
      {emails.map((email) => {
        const isExpanded = expandedId === email.messageId
        const isUnread = email.isUnread && !markReadState.readIds.has(email.messageId)
        const isMarking = markReadState.markingIds.has(email.messageId)
        return (
          <li key={email.messageId} className={isUnread ? 'bg-gray-800/35' : undefined}>
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : email.messageId)}
              aria-expanded={isExpanded}
              className="w-full space-y-0.5 px-2 py-3 text-left hover:bg-gray-800/50 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <div className="flex items-start justify-between gap-4">
                <p
                  className={`text-sm leading-snug ${isUnread ? 'font-bold text-white' : 'font-normal text-gray-300'}`}
                >
                  {email.subject}
                </p>
                <span className="shrink-0 text-xs text-gray-500">
                  {formatDateTime(email.receivedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className={isUnread ? 'text-xs font-semibold text-gray-300' : 'text-xs text-gray-500'}>
                  {email.from}
                </p>
                <span className={isUnread ? 'text-xs font-semibold text-orange-300' : 'text-xs text-gray-500'}>
                  {isUnread ? 'Nepřečteno' : 'Přečteno'}
                </span>
              </div>
              {email.snippet && !isExpanded && (
                <p className="mt-1 line-clamp-2 text-xs text-gray-500">{email.snippet}</p>
              )}
            </button>
            {isUnread && (
              <div className="flex items-center gap-2 px-2 pb-3">
                <button
                  type="button"
                  onClick={() => onMarkRead(email.messageId)}
                  disabled={isMarking}
                  className="button-action source small"
                  aria-label={`Označit e-mail ${email.subject} jako přečtený`}
                >
                  {isMarking ? '…' : 'Označit přečtené'}
                </button>
                {markReadState.errors[email.messageId] && (
                  <span role="alert" className="text-xs text-red-400">
                    {markReadState.errors[email.messageId]}
                  </span>
                )}
              </div>
            )}
            {isExpanded && (
              <div className="px-2 pb-4">
                <p className="whitespace-pre-wrap break-words rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-xs leading-relaxed text-gray-300">
                  {email.body || email.snippet || 'Tělo zprávy není k dispozici.'}
                </p>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function SlackChannelList({
  channels,
  markReadState,
  onMarkRead,
}: {
  channels: SourcePreviewSlackChannel[]
  markReadState: MarkReadState
  onMarkRead: (channelId: string, ts: string) => void
}) {
  return (
    <div className="divide-y divide-gray-800">
      {channels.map((channel) => {
        const msg = channel.messages.reduce<(typeof channel.messages)[number] | null>(
          (latest, message) => !latest || Number(message.ts) > Number(latest.ts) ? message : latest,
          null,
        )
        if (!msg) return null

        const messageKey = `${channel.channelId}:${msg.ts}`
        const isUnread = msg.isUnread && !markReadState.readIds.has(messageKey)
        const isMarking = markReadState.markingIds.has(messageKey)
        const receivedAt = slackTimestampToIso(msg.ts)
        return (
          <div key={channel.channelId} className={`px-4 py-4 ${isUnread ? 'bg-gray-800/35' : ''}`}>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-indigo-300">
                {channel.conversationType === 'dm' || channel.conversationType === 'mpim' ? '@' : '#'}
                {channel.channelName}
              </p>
              {receivedAt && (
                <time dateTime={receivedAt} className="shrink-0 text-xs text-gray-500">
                  {formatDateTime(receivedAt)}
                </time>
              )}
            </div>
            <p className={`mt-2 whitespace-pre-wrap break-words text-sm ${isUnread ? 'font-semibold text-white' : 'text-gray-400'}`}>
              <span className="mr-1.5 text-xs font-normal text-gray-500">@{msg.userName || msg.userId}</span>
              {msg.text}
            </p>
            <div className="mt-2">
              <MessageIndicators
                isUnread={isUnread}
                hasResponded={msg.hasResponded}
                isAddressedToUser={msg.isAddressedToUser}
              />
            </div>
            {isUnread && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onMarkRead(channel.channelId, msg.ts)}
                  disabled={isMarking}
                  className="button-action source small"
                  aria-label={`Označit Slack zprávu od ${msg.userName || msg.userId} jako přečtenou`}
                >
                  {isMarking ? '…' : 'Označit přečtené'}
                </button>
                {markReadState.errors[messageKey] && (
                  <span role="alert" className="text-xs text-red-400">
                    {markReadState.errors[messageKey]}
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function WorklogList({
  entries,
  date,
}: {
  entries: SourcePreviewWorklogEntry[]
  date: string
}) {
  const total = entries.reduce((sum, e) => sum + e.seconds, 0)

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        {new Date(date).toLocaleDateString('cs-CZ')} — celkem{' '}
        <span className="font-semibold text-gray-300">{formatHours(total)}</span>
      </p>
      <ul className="divide-y divide-gray-800">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start justify-between gap-4 px-2 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug text-white">{entry.title}</p>
              {entry.detail && <p className="mt-0.5 text-xs text-gray-500">{entry.detail}</p>}
            </div>
            <span className="shrink-0 text-xs text-gray-400">{formatHours(entry.seconds)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return <p className="px-2 py-3 text-sm text-gray-500">{message}</p>
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface SourcePreviewModalProps {
  connector: ConnectorInfo
  onClose: () => void
}

export default function SourcePreviewModal({ connector, onClose }: SourcePreviewModalProps) {
  const { id, label, status } = connector
  const titleId = `source-preview-${id}-title`
  const webUrl = CONNECTOR_WEB_URLS[id]
  const icon = SOURCE_ICONS[id]
  const isUsable = status === 'connected' || status === 'warning'
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const accessToken = useAuthStore((state) => state.accessToken)
  const queryClient = useQueryClient()
  const [markReadState, setMarkReadState] = useState<MarkReadState>({
    markingIds: new Set(),
    readIds: new Set(),
    errors: {},
  })

  // Odpojený zdroj nemá co zobrazit – dotaz vůbec nespouštíme.
  const { data, isLoading, isError, errorMessage, refetch, isFetching } = useSourcePreview(
    isUsable ? id : null,
  )

  useEscapeKey(onClose)

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  const providerError = data && 'error' in data ? data.error : undefined

  async function markRead(messageKey: string, action: () => Promise<void>): Promise<void> {
    setMarkReadState((state) => ({
      ...state,
      markingIds: new Set(state.markingIds).add(messageKey),
      errors: { ...state.errors, [messageKey]: '' },
    }))
    try {
      await action()
      setMarkReadState((state) => {
        const markingIds = new Set(state.markingIds)
        markingIds.delete(messageKey)
        return { ...state, markingIds, readIds: new Set(state.readIds).add(messageKey) }
      })
      queryClient.setQueryData<SourcePreviewData>(['sourcePreview', id], (current) => {
        if (!current) return current
        if (current.kind === 'gmail') {
          return {
            ...current,
            emails: current.emails.map((email) =>
              email.messageId === messageKey ? { ...email, isUnread: false } : email,
            ),
          }
        }
        if (current.kind === 'slack') {
          return {
            ...current,
            channels: current.channels.map((channel) => ({
              ...channel,
              messages: channel.messages.map((message) =>
                `${channel.channelId}:${message.ts}` === messageKey
                  ? { ...message, isUnread: false }
                  : message,
              ),
            })),
          }
        }
        return current
      })
      void queryClient.invalidateQueries({ queryKey: ['user-stats'] })
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
    } catch {
      setMarkReadState((state) => {
        const markingIds = new Set(state.markingIds)
        markingIds.delete(messageKey)
        return {
          ...state,
          markingIds,
          errors: { ...state.errors, [messageKey]: 'Označení jako přečtené se nezdařilo.' },
        }
      })
    }
  }

  function renderBody() {
    if (!isUsable) {
      return (
        <EmptyState
          message={`Zdroj není připojen (${status}). Připoj ho v sekci Zdroje nebo ho otevři v prohlížeči.`}
        />
      )
    }

    if (isLoading) {
      return (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse space-y-2 px-2" aria-hidden="true">
              <div className="h-4 w-2/3 rounded bg-gray-700" />
              <div className="h-3 w-1/3 rounded bg-gray-800" />
            </div>
          ))}
        </div>
      )
    }

    if (isError || providerError) {
      return (
        <div role="alert" className="rounded-md border border-red-800 bg-red-950/50 px-4 py-3">
          <p className="text-sm text-red-300">Obsah zdroje se nepodařilo načíst.</p>
          {(errorMessage ?? providerError) && (
            <p className="mt-1 text-xs text-red-400">{errorMessage ?? providerError}</p>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 text-xs text-red-300 underline hover:text-red-100 focus:outline-none focus:ring-1 focus:ring-red-400"
          >
            Zkusit znovu
          </button>
        </div>
      )
    }

    if (!data) return <EmptyState message="Žádné položky." />

    switch (data.kind) {
      case 'gmail':
        return data.emails.length === 0 ? (
          <EmptyState message="Žádné e-maily." />
        ) : (
          <EmailList
            emails={data.emails}
            markReadState={markReadState}
            onMarkRead={(messageId) => void markRead(
              messageId,
              () => markGmailPreviewRead(accessToken ?? '', messageId),
            )}
          />
        )
      case 'slack':
        return data.channels.length === 0 ? (
          <EmptyState message="Žádné nepřečtené zprávy." />
        ) : (
          <SlackChannelList
            channels={data.channels}
            markReadState={markReadState}
            onMarkRead={(channelId, ts) => void markRead(
              `${channelId}:${ts}`,
              () => markSlackPreviewRead(accessToken ?? '', channelId, ts),
            )}
          />
        )
      case 'worklogs':
        return data.entries.length === 0 ? (
          <EmptyState message="Pro dnešní den nejsou zaznamenané žádné worklogy." />
        ) : (
          <WorklogList entries={data.entries} date={data.date} />
        )
      case 'unavailable':
      default:
        return <EmptyState message="Náhled obsahu pro tento zdroj není dostupný." />
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-[90vw] flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-gray-800 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {icon && <img src={icon} alt="" aria-hidden="true" className="h-5 w-5 object-contain" />}
            <h2 id={titleId} className="truncate text-base font-semibold text-gray-100">
              {label}
            </h2>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isUsable && (
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-yellow-400 rounded"
                aria-label={`Obnovit náhled ${label}`}
              >
                {isFetching ? 'Obnovuji…' : 'Obnovit'}
              </button>
            )}
            {webUrl && (
              <a
                href={webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="button-action source small"
              >
                Otevřít v prohlížeči ↗
              </a>
            )}
            <button
              type="button"
              ref={closeButtonRef}
              onClick={onClose}
              aria-label="Zavřít"
              className="rounded p-1 text-gray-500 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{renderBody()}</div>
      </div>
    </div>
  )
}
