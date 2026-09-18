import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ScanProposalData } from '@houston/shared-types'
import { API_BASE_URL } from '../../config/api'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import { MarkReadSuccessModal } from './MarkReadSuccessModal'
import gmailIcon from '../img/gmail.webp'
import slackIcon from '../img/slack.webp'
import {
  upsertIssue,
  createClient,
  createProject,
  upsertCalendarLink,
  searchIssues,
  fetchClients,
  fetchProjects,
  fetchCalendarLink,
} from '../../services/projectsClient'

const TIER_STYLES: Record<number, string> = {
  1: 'border-red-700 bg-red-950',
  2: 'border-orange-700 bg-orange-950',
}

const TIER_LABELS: Record<number, string> = {
  1: 'Vyžaduje akci',
  2: 'Důležitá aktualizace',
}

function formatSourceDate(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })
}

function parseOriginalMessage(msg: string) {
  const fromMatch = msg.match(/^From: (.+)$/m)
  const toMatch = msg.match(/^To: (.+)$/m)
  const ccMatch = msg.match(/^CC: (.+)$/m)
  const subjectMatch = msg.match(/^Subject: (.+)$/m)
  const channelMatch = msg.match(/^Channel: #(.+)$/m)
  const authorMatch = msg.match(/^Author: @(.+)$/m)
  const dateMatch = msg.match(/^Date: (.+)$/m)
  const rawDate = dateMatch?.[1]?.trim()
  const date = formatSourceDate(rawDate)
  const rawFrom = fromMatch?.[1]?.trim() ?? ''
  const fromNameMatch = rawFrom.match(/^(.+?)\s*<[^>]+>$/)
  const fromEmailMatch = rawFrom.match(/<([^>]+)>$/) ?? rawFrom.match(/^([^\s]+@[^\s]+)$/)
  const from = fromNameMatch?.[1]?.trim() || fromEmailMatch?.[1]?.trim() || rawFrom
  return {
    from,
    to: toMatch?.[1]?.trim() ?? '',
    cc: ccMatch?.[1]?.trim() ?? '',
    subject: subjectMatch?.[1]?.trim() ?? '',
    channel: channelMatch?.[1]?.trim() ?? '',
    author: authorMatch?.[1]?.trim() ?? '',
    date,
  }
}

function appendSignature(draft: string, signature: string): string {
  if (!signature.trim()) return draft
  return draft ? `${draft}\n\n${signature}` : signature
}

function persistProposalStatus(id: string, status: NonNullable<ScanProposalData['status']>): void {
  try {
    const raw = localStorage.getItem('houston_last_scan')
    if (!raw) return
    const saved = JSON.parse(raw) as { proposals?: ScanProposalData[] }
    if (!Array.isArray(saved.proposals)) return
    localStorage.setItem('houston_last_scan', JSON.stringify({
      ...saved,
      proposals: saved.proposals.map((proposal) =>
        proposal.id === id ? { ...proposal, status } : proposal,
      ),
    }))
  } catch { /* storage unavailable */ }
}

function renderStatusLabel(status: ScanProposalData['status']) {
  if (status === 'PENDING') return 'Čeká'
  if (status === 'APPROVED') return 'Schváleno'
  if (status === 'REJECTED') return 'Archivováno'
  if (status === 'EXECUTED') return 'Provedeno'
  if (status === 'EXPIRED') return 'Expirováno'
  if (status === 'READ') return 'Přečteno'
  return ''
}

function getStatusStyle(status: ScanProposalData['status']) {
  return {
    backgroundColor:
      status === 'APPROVED' ? '#166534' :
      status === 'REJECTED' ? '#444' :
      status === 'EXECUTED' ? '#1e293b' :
      status === 'EXPIRED' ? '#7c2d12' :
      status === 'READ' ? '#1e3a5f' :
      '#334155',
    color:
      status === 'APPROVED' ? '#bbf7d0' :
      status === 'REJECTED' ? '#e5e7eb' :
      status === 'EXECUTED' ? '#bae6fd' :
      status === 'EXPIRED' ? '#fdba74' :
      status === 'READ' ? '#93c5fd' :
      '#e0e7ef',
  }
}

type MarkReadResponse = {
  success: true
  data: {
    source: 'gmail' | 'slack'
  }
}

function isMarkReadResponse(value: unknown): value is MarkReadResponse {
  if (typeof value !== 'object' || value === null) return false
  const response = value as { success?: unknown; data?: { source?: unknown } }
  return response.success === true && (response.data?.source === 'gmail' || response.data?.source === 'slack')
}

type ProposalCardProps = {
  proposal: ScanProposalData
  onRemove?: () => void
  onStatusChange?: (status: ScanProposalData['status']) => void
  isExpanded?: boolean
  onToggleExpand?: () => void
}

export function ProposalCard({ proposal, onRemove, onStatusChange, isExpanded = true, onToggleExpand }: ProposalCardProps) {
  const { slackSignature, emailSignature, timeSavingsSecondsPerMarkRead } = useSettingsStore()
  const signature = proposal.system === 'slack' ? slackSignature : emailSignature

  const [archiving, setArchiving] = useState(false)
  const [archived, setArchived] = useState(proposal.status === 'REJECTED')
  const [resolved, setResolved] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [markedRead, setMarkedRead] = useState(proposal.status === 'READ')
  const [markingRead, setMarkingRead] = useState(false)
  const [showMarkReadSuccess, setShowMarkReadSuccess] = useState(false)
  const [markReadSource, setMarkReadSource] = useState<'gmail' | 'slack' | null>(null)
  const [actionError, setActionError] = useState('')
  const [editedDraft, setEditedDraft] = useState(() => appendSignature(proposal.draft ?? '', signature))
  const [replyHint, setReplyHint] = useState('')
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const approveWithDraft = useProposalAction(proposal.id, 'approve')
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  // Close confirm modal on Escape key
  useEffect(() => {
    if (!showConfirm) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowConfirm(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showConfirm])

  const [saved, setSaved] = useState({
    issueKey: false,
    client: false,
    project: false,
    calendarLink: false,
  })

  const [saving, setSaving] = useState({
    issueKey: false,
    client: false,
    project: false,
    calendarLink: false,
  })

  const [badgeError, setBadgeError] = useState({
    issueKey: false,
    client: false,
    project: false,
    calendarLink: false,
  })

  // On mount: hydrate saved state from DB so badges reflect persisted data after refresh
  useEffect(() => {
    let cancelled = false
    async function checkSaved() {
      const [issueR, clientR, projectR, calR] = await Promise.allSettled([
        proposal.issueKey
          ? searchIssues(accessToken, proposal.issueKey).then((issues) =>
              issues.some((i) => i.issueKey === proposal.issueKey),
            )
          : Promise.resolve(false),
        proposal.detectedClientId
          ? Promise.resolve(true)
          : proposal.detectedClient
            ? fetchClients(accessToken).then((clients) =>
                clients.some((c) => c.name === proposal.detectedClient),
              )
            : Promise.resolve(false),
        proposal.projectKey
          ? fetchProjects(accessToken).then((projects) =>
              projects.some((p) => p.jiraProjectKey === proposal.projectKey),
            )
          : Promise.resolve(false),
        proposal.calendarEventId
          ? fetchCalendarLink(accessToken, proposal.calendarEventId).then(
              (link) => link !== null,
            )
          : Promise.resolve(false),
      ])
      if (cancelled) return
      setSaved({
        issueKey: issueR.status === 'fulfilled' ? issueR.value : false,
        client: clientR.status === 'fulfilled' ? clientR.value : false,
        project: projectR.status === 'fulfilled' ? projectR.value : false,
        calendarLink: calR.status === 'fulfilled' ? calR.value : false,
      })
    }
    void checkSaved()
    return () => { cancelled = true }
  }, [accessToken, proposal.issueKey, proposal.detectedClient, proposal.projectKey, proposal.calendarEventId])

  const saveIssueKey = useCallback(async () => {
    if (!proposal.issueKey || saved.issueKey || saving.issueKey) return
    setSaving((s) => ({ ...s, issueKey: true }))
    setBadgeError((s) => ({ ...s, issueKey: false }))
    try {
      await upsertIssue(accessToken, { issueKey: proposal.issueKey, summary: proposal.summary ?? '' })
      setSaved((s) => ({ ...s, issueKey: true }))
    } catch (err) {
      console.error('[ProposalCard] saveIssueKey failed:', err)
      setBadgeError((s) => ({ ...s, issueKey: true }))
    } finally {
      setSaving((s) => ({ ...s, issueKey: false }))
    }
  }, [accessToken, proposal.issueKey, proposal.summary, saved.issueKey, saving.issueKey])

  const saveClient = useCallback(async () => {
    if (!proposal.detectedClient || saved.client || saving.client) return
    setSaving((s) => ({ ...s, client: true }))
    setBadgeError((s) => ({ ...s, client: false }))
    try {
      await createClient(accessToken, { name: proposal.detectedClient })
      setSaved((s) => ({ ...s, client: true }))
    } catch (err) {
      console.error('[ProposalCard] saveClient failed:', err)
      setBadgeError((s) => ({ ...s, client: true }))
    } finally {
      setSaving((s) => ({ ...s, client: false }))
    }
  }, [accessToken, proposal.detectedClient, saved.client, saving.client])

  const saveProject = useCallback(async () => {
    if (!proposal.projectKey || saved.project || saving.project) return
    setSaving((s) => ({ ...s, project: true }))
    setBadgeError((s) => ({ ...s, project: false }))
    try {
      await createProject(accessToken, { name: proposal.projectKey, jiraProjectKey: proposal.projectKey })
      setSaved((s) => ({ ...s, project: true }))
    } catch (err) {
      console.error('[ProposalCard] saveProject failed:', err)
      setBadgeError((s) => ({ ...s, project: true }))
    } finally {
      setSaving((s) => ({ ...s, project: false }))
    }
  }, [accessToken, proposal.projectKey, saved.project, saving.project])

  const saveCalendarLink = useCallback(async () => {
    if (!proposal.calendarEventId || !proposal.issueKey || saved.calendarLink || saving.calendarLink) return
    setSaving((s) => ({ ...s, calendarLink: true }))
    setBadgeError((s) => ({ ...s, calendarLink: false }))
    try {
      await upsertCalendarLink(accessToken, proposal.calendarEventId, { issueKey: proposal.issueKey })
      setSaved((s) => ({ ...s, calendarLink: true }))
    } catch (err) {
      console.error('[ProposalCard] saveCalendarLink failed:', err)
      setBadgeError((s) => ({ ...s, calendarLink: true }))
    } finally {
      setSaving((s) => ({ ...s, calendarLink: false }))
    }
  }, [accessToken, proposal.calendarEventId, proposal.issueKey, saved.calendarLink, saving.calendarLink])

  const parsed = proposal.originalMessage ? parseOriginalMessage(proposal.originalMessage) : { from: '', to: '', cc: '', subject: '', channel: '', author: '', date: '' }
  const sourceDate = proposal.system === 'gmail' || proposal.system === 'slack'
    ? formatSourceDate(proposal.sourceOccurredAt) || parsed.date
    : ''
  const sourceDateLabel = proposal.system === 'gmail' ? 'Přijato' : 'Odesláno'
  const proposalStatus = proposal.status ?? 'PENDING'

  const handleConfirmKnowledgeAction = useCallback(async () => {
    setArchiving(true)
    const ok = await approveWithDraft(undefined)
    setTimeout(() => {
      setArchiving(false)
      if (ok) {
        setResolved(true)
        persistProposalStatus(proposal.id, 'APPROVED')
        onStatusChange?.('APPROVED')
      }
    }, 350)
  }, [approveWithDraft, onStatusChange])

  const handleGenerateDraft = useCallback(async () => {
    if (!replyHint.trim() || generatingDraft) return
    setGeneratingDraft(true)
    try {
      const res = await fetch(`${API_BASE_URL}/proposals/${proposal.id}/regenerate-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ hint: replyHint }),
      })
      if (res.ok) {
        const json = await res.json() as { success: boolean; data: { draft: string } }
        setEditedDraft(appendSignature(json.data.draft, signature))
        setReplyHint('')
      }
    } finally {
      setGeneratingDraft(false)
    }
  }, [replyHint, generatingDraft, proposal.id, accessToken])

  const handleMarkRead = useCallback(async (showFeedback = false) => {
    if (markingRead || markedRead) return
    setMarkingRead(true)
    setActionError('')
    try {
      const res = await fetch(`${API_BASE_URL}/proposals/${proposal.id}/mark-read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      })
      if (!res.ok) {
        setActionError('Označení zprávy jako přečtené se nezdařilo.')
        return
      }
      const response: unknown = await res.json()
      if (!isMarkReadResponse(response)) {
        setActionError('Označení zprávy jako přečtené se nezdařilo.')
        return
      }
      setMarkedRead(true)
      persistProposalStatus(proposal.id, 'READ')
      onStatusChange?.('READ')
      void queryClient.invalidateQueries({ queryKey: ['user-stats'] })
      if (showFeedback) {
        setMarkReadSource(response.data.source)
        setShowMarkReadSuccess(true)
      }
    } catch {
      setActionError('Označení zprávy jako přečtené se nezdařilo.')
    } finally {
      setMarkingRead(false)
    }
  }, [proposal.id, accessToken, onStatusChange, queryClient])

  const handleConfirmReply = useCallback(async () => {
    setShowConfirm(false)
    setArchiving(true)
    const ok = await approveWithDraft(editedDraft)
    if (!ok) {
      setArchiving(false)
      return
    }
    // Inkrementace počtu odbavených zpráv
    try {
      const resp = await fetch(`${API_BASE_URL}/users/me/increment-processed-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      })
      if (resp.ok) {
        queryClient.invalidateQueries({ queryKey: ['user-stats'] })
      } else {
        console.warn('Increment processed messages responded with', resp.status)
      }
    } catch (err) {
      // Log error, ale neblokuje UI
      console.error('Failed to increment processed messages', err)
    }
    if (proposal.system === 'slack') {
      await handleMarkRead(false)
    }
    onStatusChange?.('APPROVED')
    persistProposalStatus(proposal.id, 'APPROVED')
    setTimeout(() => {
      setArchiving(false)
      setResolved(true)
      if (onRemove) onRemove()
    }, 350)
  }, [editedDraft, approveWithDraft, onRemove, onStatusChange, accessToken, proposal.system, handleMarkRead])

  const handleResolveDocumentReview = useCallback(async () => {
    if (markingRead || markedRead) return
    setMarkingRead(true)
    setActionError('')
    try {
      const res = await fetch(`${API_BASE_URL}/proposals/${proposal.id}/resolve-document-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      })
      if (!res.ok) {
        setActionError('Dokument se nepodařilo označit jako vyřešený.')
        return
      }
      setMarkedRead(true)
      persistProposalStatus(proposal.id, 'READ')
      onStatusChange?.('READ')
      void queryClient.invalidateQueries({ queryKey: ['user-stats'] })
      setMarkReadSource('gmail')
      setShowMarkReadSuccess(true)
    } catch {
      setActionError('Dokument se nepodařilo označit jako vyřešený.')
    } finally {
      setMarkingRead(false)
    }
  }, [proposal.id, accessToken, markedRead, markingRead, onStatusChange, queryClient])

  // Animace archivace: zmenšení, šedé pozadí, pouze info text
  const reject = useCallback(async () => {
    setArchiving(true)
    setActionError('')
    let ok = false
    try {
      const res = await fetch(`${API_BASE_URL}/proposals/${proposal.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      })
      ok = res.ok
    } catch {}
    if (!ok) {
      setArchiving(false)
      setActionError('Archivace návrhu se nezdařila.')
      return
    }
    onStatusChange?.('REJECTED')
    persistProposalStatus(proposal.id, 'REJECTED')
    setTimeout(() => {
      setArchiving(false)
      setArchived(true)
      if (onRemove) onRemove()
    }, 350)
  }, [proposal.id, onRemove, onStatusChange, accessToken])

  if (proposal.kind === 'DOCUMENT_REVIEW') {
    const inactive = archiving || archived || markedRead
    return (
      <div
        ref={cardRef}
        className={`proposal rounded-lg border p-4 space-y-3 transition-all duration-300 ${inactive ? 'border-gray-700 bg-gray-900' : TIER_STYLES[proposal.tier] ?? 'border-orange-700 bg-orange-950'}`}
      >
        {markedRead ? (
          <div className="text-gray-500 text-sm italic">Komentáře v dokumentu byly označeny jako vyřešené.</div>
        ) : archived ? (
          <div className="text-gray-500 text-sm italic">Návrh byl archivován</div>
        ) : (
          <>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-orange-300">
                Tier {proposal.tier} · Google Docs · {proposal.sourceMessageIds?.length ?? 1} komentářů
              </span>
              <p className="font-bold text-gray-100 mt-1">{proposal.summary}</p>
              {proposal.detail && (
                <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{proposal.detail}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {proposal.url && (
                <a
                  href={proposal.url}
                  target="_blank"
                  rel="noreferrer"
                  className="button-action source small"
                >
                  Otevřít dokument ↗
                </a>
              )}
              <button
                type="button"
                onClick={() => void handleResolveDocumentReview()}
                disabled={markingRead || archiving}
                className="button-action local"
              >
                {markingRead ? '…' : 'Vyřešeno'}
              </button>
              <button
                type="button"
                onClick={reject}
                disabled={archiving || markingRead}
                className="button-action local"
              >
                Archivovat
              </button>
            </div>
            {actionError && <p className="text-xs text-red-400" role="alert">{actionError}</p>}
          </>
        )}
        {showMarkReadSuccess && markReadSource && (
          <MarkReadSuccessModal
            source={markReadSource}
            savedSeconds={timeSavingsSecondsPerMarkRead}
            onClose={() => setShowMarkReadSuccess(false)}
          />
        )}
      </div>
    )
  }

  // Knowledge action proposal – simplified teal card, no draft editor
  if (proposal.system === 'knowledge') {
    const archivedStyle = archiving || resolved || archived
    return (
      <div
        ref={cardRef}
        className={`proposal rounded-lg border p-4 space-y-3 transition-all duration-300 ease-in-out ${
          archivedStyle ? 'border-gray-700 bg-gray-900' : 'border-teal-700 bg-teal-950'
        }`}
        style={archivedStyle ? { maxHeight: 56, paddingTop: 12, paddingBottom: 12, overflow: 'hidden' } : {}}
      >
        {archiving ? (
          <div className="text-gray-500 text-sm italic">Provádím…</div>
        ) : resolved ? (
          <div className="text-gray-500 text-sm italic">
            <span className="text-emerald-400 mr-2">✓</span>Akce byla provedena
          </div>
        ) : archived ? (
          <div className="text-gray-500 text-sm italic">Akce byla zrušena</div>
        ) : (
          <>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-teal-600">
                Knowledge · Akce k potvrzení
              </span>
              <p className="font-bold text-teal-200 mt-0.5">{proposal.summary}</p>
              {proposal.detail && (
                <p className="text-sm text-teal-400 mt-1">{proposal.detail}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void handleConfirmKnowledgeAction()}
                disabled={archiving}
                className="px-3 py-1.5 bg-teal-700 hover:bg-teal-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Provést
              </button>
              <button
                onClick={reject}
                disabled={archiving}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
              >
                Zrušit
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Styl pro archivovanou animaci
  const archivedClass = archiving || archived || markedRead
    ? 'border-gray-700 bg-gray-900 text-gray-500'
    : TIER_STYLES[proposal.tier] ?? 'border-gray-700 bg-gray-800'
  const showCollapsedHeader = !archiving && !markedRead && !resolved && !archived && !isExpanded

  return (
    <div
      ref={cardRef}
      className={`proposal rounded-lg border p-4 space-y-3 transition-all duration-300 ease-in-out ${archivedClass} ${archiving ? 'scale-95 opacity-100' : ''}`}
      style={archiving || archived || resolved || markedRead ? { maxHeight: 56, paddingTop: 12, paddingBottom: 12, overflow: 'hidden', background: '#151515', border: '1px solid #2c2c2c' } : {}}
    >
      {archiving ? (
        <div className="w-full text-gray-500 text-sm italic">Procesuji...</div>
      ) : markedRead ? (
        <div className="w-full text-gray-500 text-sm italic">
          <span aria-hidden="true" className="inline-flex items-center justify-center w-4 h-4 bg-transparent text-emerald-400 mr-2 align-middle text-xs">✓</span>
          Návrh byl vyřešen (zpráva označena jako přečtená)
        </div>
      ) : resolved ? (
        <div className="w-full text-gray-500 text-sm italic">
          <span aria-hidden="true" className="inline-flex items-center justify-center w-4 h-4 bg-transparent text-emerald-400 mr-2 align-middle text-xs">✓</span>
          Návrh byl vyřízen
        </div>
      ) : archived ? (
        <div className="w-full text-gray-500 text-sm italic">Návrh byl archivován</div>
      ) : showCollapsedHeader ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className="w-full text-left"
          aria-expanded={isExpanded}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <span className="text-gray-400 text-sm leading-6" aria-hidden="true">▸</span>
              <div className="min-w-0">
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#5c6572' }}>
                  Tier {proposal.tier} · {TIER_LABELS[proposal.tier] ?? 'FYI'} · {proposal.system}
                </span>
                {sourceDate && (
                  <span className="block text-xs" style={{ color: '#5c6572' }}>
                    {sourceDateLabel}: {sourceDate}
                  </span>
                )}
                <p className="font-bold truncate" style={{ color: '#d8e5f6' }}>
                  {proposal.summary}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5 min-w-[80px]">
              {proposal.confidence !== undefined && (
                <span className="text-xs text-gray-300 shrink-0">
                  Confidence {Math.round(proposal.confidence * 100)}%
                </span>
              )}
              <span
                className="text-xs px-2 py-0.5 rounded font-semibold tracking-wide"
                style={getStatusStyle(proposalStatus)}
              >
                {renderStatusLabel(proposalStatus)}
              </span>
            </div>
          </div>
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={onToggleExpand}
            className="w-full text-left"
            aria-expanded={isExpanded}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <span className="text-gray-400 text-sm leading-6" aria-hidden="true">▾</span>
                <div className="min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#5c6572' }}>
                    Tier {proposal.tier} · {TIER_LABELS[proposal.tier] ?? 'FYI'} · {proposal.system}
                  </span>
                  {sourceDate && (
                    <span className="block text-xs" style={{ color: '#5c6572' }}>
                      {sourceDateLabel}: {sourceDate}
                    </span>
                  )}
                  <p className="font-bold" style={{ color: '#d8e5f6' }}>
                    {(parsed.from || parsed.author) && (
                      <span className="font-normal mr-1" style={{ color: '#7a9bbf' }}>
                        {proposal.system === 'gmail' && <img src="/src/components/img/gmail.webp" alt="gmail" className="inline w-4 h-4 mr-2 align-text-bottom" />}
                        {proposal.system === 'slack' && <img src="/src/components/img/slack.webp" alt="slack" className="inline w-4 h-4 mr-2 align-text-bottom" />}
                        {parsed.from || parsed.author}:
                      </span>
                    )}
                    {proposal.summary}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5 min-w-[80px]">
                {proposal.confidence !== undefined && (
                  <span className="text-xs text-gray-300 shrink-0">
                    Confidence {Math.round(proposal.confidence * 100)}%
                  </span>
                )}
                <span
                  className="text-xs px-2 py-0.5 rounded font-semibold tracking-wide"
                  style={getStatusStyle(proposalStatus)}
                >
                  {renderStatusLabel(proposalStatus)}
                </span>
              </div>
            </div>
          </button>


          <div className="flex gap-4">
            {proposal.originalMessage && (
              <div style={{ maxWidth: '49%' }}>
                <span className="block text-gray-500 mb-0.5" style={{ fontSize: '12px' }}>Originální zpráva:</span>
                <div className="original mb-1 p-2 rounded bg-gray-800 text-xs text-gray-300 border border-gray-700 whitespace-pre-wrap">
                  {proposal.originalMessage}
                </div>
                {parsed.to && (
                  <span className="block text-gray-500 mb-0.5" style={{ fontSize: '11px' }}>Komu: <span className="text-gray-400">{parsed.to}</span></span>
                )}
                {parsed.cc && (
                  <span className="block text-gray-500 mb-1" style={{ fontSize: '11px' }}>Kopie: <span className="text-gray-400">{parsed.cc}</span></span>
                )}
                {proposal.detail && <p className="text-sm" style={{ color: '#5c6572', marginTop: 0 }}>{proposal.detail}</p>}
                {(proposal.system === 'gmail' || proposal.system === 'slack') && (
                  <div className="mt-2 mb-2">
                    <button
                      className="button-action source small"
                      onClick={() => void handleMarkRead(true)}
                      disabled={markingRead || markedRead}
                      title="Po kliknutí na tlačítko bude původní zpráva označena jako přečtená, proposal se označí jako vyřešený"
                    >
                      {markedRead ? 'Přečteno ✓' : markingRead ? '…' : 'Označit přečtené'}
                    </button>
                  </div>
                )}
                {actionError && <p className="mt-2 text-xs text-red-400" role="alert">{actionError}</p>}
          {/* ── Detekované entity ── */}
          {(proposal.issueKey || proposal.projectKey || proposal.detectedClient || proposal.calendarEventId) && (
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {proposal.issueKey && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">issue:</span>
                  <button
                    type="button"
                    title={saved.issueKey ? 'Uloženo do cache' : badgeError.issueKey ? 'Chyba – klikni pro opakování' : 'Klikni pro uložení do cache'}
                    onClick={saveIssueKey}
                    disabled={saving.issueKey || saved.issueKey}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono ${
                      badgeError.issueKey
                        ? 'bg-red-950 text-red-300 border border-dashed border-red-600 cursor-pointer'
                        : saved.issueKey
                          ? 'bg-yellow-950 text-yellow-300 border border-yellow-700 cursor-default'
                          : saving.issueKey
                            ? 'bg-yellow-950 text-yellow-400 border border-dashed border-yellow-600 cursor-wait opacity-60'
                            : 'bg-yellow-950 text-yellow-300 border border-dashed border-yellow-700 hover:border-yellow-400 cursor-pointer'
                    }`}
                  >
                    {saving.issueKey ? '⏳' : badgeError.issueKey ? '⚠️' : '🔖'} {proposal.issueKey}{saved.issueKey && ' ✓'}
                  </button>
                </div>
              )}
              {proposal.projectKey && !proposal.issueKey && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">projekt:</span>
                  <button
                    type="button"
                    title={saved.project ? 'Uloženo do projektů' : badgeError.project ? 'Chyba – klikni pro opakování' : 'Klikni pro uložení projektu'}
                    onClick={saveProject}
                    disabled={saving.project || saved.project}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono ${
                      badgeError.project
                        ? 'bg-red-950 text-red-300 border border-dashed border-red-600 cursor-pointer'
                        : saved.project
                          ? 'bg-gray-800 text-gray-300 border border-gray-600 cursor-default'
                          : saving.project
                            ? 'bg-gray-800 text-gray-400 border border-dashed border-gray-600 cursor-wait opacity-60'
                            : 'bg-gray-800 text-gray-300 border border-dashed border-gray-600 hover:border-gray-400 cursor-pointer'
                    }`}
                  >
                    {saving.project ? '⏳' : badgeError.project ? '⚠️' : '📁'} {proposal.projectKey}{saved.project && ' ✓'}
                  </button>
                </div>
              )}
              {proposal.detectedClient && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">klient:</span>
                  <button
                    type="button"
                    title={saved.client ? 'Uloženo do klientů' : badgeError.client ? 'Chyba – klikni pro opakování' : 'Klikni pro uložení klienta'}
                    onClick={saveClient}
                    disabled={saving.client || saved.client}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                      badgeError.client
                        ? 'bg-red-950 text-red-300 border border-dashed border-red-600 cursor-pointer'
                        : saved.client
                          ? 'bg-blue-950 text-blue-300 border border-blue-700 cursor-default'
                          : saving.client
                            ? 'bg-blue-950 text-blue-400 border border-dashed border-blue-600 cursor-wait opacity-60'
                            : 'bg-blue-950 text-blue-300 border border-dashed border-blue-700 hover:border-blue-400 cursor-pointer'
                    }`}
                  >
                    {saving.client ? '⏳' : badgeError.client ? '⚠️' : '🏢'} {proposal.detectedClient}{saved.client && ' ✓'}
                  </button>
                </div>
              )}
              {proposal.calendarEventId && proposal.issueKey && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">kalendář:</span>
                  <button
                    type="button"
                    title={saved.calendarLink ? 'Vazba uložena' : badgeError.calendarLink ? 'Chyba – klikni pro opakování' : 'Klikni pro uložení vazby událost → issue'}
                    onClick={saveCalendarLink}
                    disabled={saving.calendarLink || saved.calendarLink}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                      badgeError.calendarLink
                        ? 'bg-red-950 text-red-300 border border-dashed border-red-600 cursor-pointer'
                        : saved.calendarLink
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700 cursor-default'
                          : saving.calendarLink
                            ? 'bg-emerald-950 text-emerald-400 border border-dashed border-emerald-600 cursor-wait opacity-60'
                            : 'bg-emerald-950 text-emerald-300 border border-dashed border-emerald-700 hover:border-emerald-400 cursor-pointer'
                    }`}
                  >
                    {saving.calendarLink ? '⏳' : badgeError.calendarLink ? '⚠️' : '📅'} Kalendář{saved.calendarLink && ' ✓'}
                  </button>
                </div>
              )}
            </div>
          )}

              </div>
            )}

            <div className="flex-1" style={{ minWidth: '50%' }}>
                <span className="block mb-0.5" style={{ fontSize: '12px', color: '#af9aff' }}>Jak chcete odpovědět:</span>
              <div className='flex gap-2 mb-2'>
                <input
                  className="reply-hint-input rounded py-0 px-2 text-sm text-gray-200 w-full resize-none border border-gray-700 focus:border-purple-600 focus:outline-none"
                  value={replyHint}
                  onChange={(e) => setReplyHint(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleGenerateDraft() }}
                  placeholder="Popiš, jak chceš odpovědět"
                  disabled={generatingDraft}
                />
                <button
                  className="button-action local transition-colors min-w-[100px]"
                  onClick={() => void handleGenerateDraft()}
                  disabled={generatingDraft || !replyHint.trim()}
                >
                  {generatingDraft ? '…' : 'Nový návrh'}
                </button>
              </div>
              <span className="block mb-0.5" style={{ fontSize: '12px', color: '#af9aff' }}>Návrh odpovědi:</span>
              <textarea
                className="draft rounded p-3 text-sm text-gray-200 w-full resize-none border border-gray-700 focus:border-purple-600 focus:outline-none"
                rows={6}
                value={editedDraft}
                onChange={(e) => setEditedDraft(e.target.value)}
              />
              <div className="flex justify-start items-center gap-2 pt-1">
                <button
                  onClick={() => setShowConfirm(true)}
                  className="button-action local transition-colors"
                >
                  Odpovědět
                </button>
                <button
                  onClick={reject}
                  className="button-action local transition-colors"
                  disabled={archiving}
                >
                  Neprovádět akci a archivovat
                </button>
                {proposal.url && (
                  <a
                    href={proposal.url}
                    target="_blank"
                    rel="noreferrer"
                    className="button-action local transition-colors"
                  >
                    Otevřít ↗
                  </a>
                )}
              </div>            
            </div>
          </div>



          {showConfirm && (
            <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-50">
              <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 w-[480px] space-y-4">
                <h2 className="text-white font-bold">Odeslat odpověď?</h2>
                <div className="text-sm text-gray-400 space-y-1">
                  {proposal.system === 'slack' ? (
                    <>
                      <div><span className="text-gray-500">Kanál:</span> #{parsed.channel || '(neznámý)'}</div>
                      <div><span className="text-gray-500">Vlákno:</span> odpověď do vlákna</div>
                    </>
                  ) : (
                    <>
                      <div><span className="text-gray-500">Komu:</span> {parsed.from || '(neznámý)'}</div>
                      <div><span className="text-gray-500">Předmět:</span> Re: {parsed.subject || '(bez předmětu)'}</div>
                    </>
                  )}
                  <div className="mt-2 p-2 bg-gray-800 rounded text-gray-300 text-xs whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {editedDraft || '(prázdná odpověď)'}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowConfirm(false)} className="button-action local">Zrušit</button>
                  <button onClick={handleConfirmReply} className="button-action source">
                    {proposal.system === 'gmail' && <img src={gmailIcon} alt="" className="h-4 w-4" />}
                    {proposal.system === 'slack' && <img src={slackIcon} alt="" className="h-4 w-4" />}
                    Potvrdit a odeslat
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {showMarkReadSuccess && markReadSource && (
        <MarkReadSuccessModal
          source={markReadSource}
          savedSeconds={timeSavingsSecondsPerMarkRead}
          onClose={() => setShowMarkReadSuccess(false)}
        />
      )}
    </div>
  )
}

function useProposalAction(proposalId: string, action: 'approve' | 'reject') {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useCallback(async (draft?: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE_URL}/proposals/${proposalId}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(action === 'approve' && draft !== undefined ? { draft } : {}),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
        console.warn(`[ProposalCard] ${action} failed: ${res.status}`, body?.error?.message ?? '')
        return false
      }
      return true
    } catch {
      return false
    }
  }, [proposalId, action, accessToken]);
}
