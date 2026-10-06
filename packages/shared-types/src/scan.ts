/** Shared types for the Houston Scan feature (used by both backend and desktop). */

// ─── SSE event types (matches docs/04-api-contracts.md) ──────────────────────

export type ScanEventType = 'progress' | 'log' | 'proposal' | 'auto_read_suggestions' | 'completed' | 'error'

export type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'EXPIRED' | 'READ'
export type ProposalKind = 'MESSAGE_REPLY' | 'DOCUMENT_REVIEW'

export type ScanPhase = 'fetch' | 'classify' | 'save' | 'done' | 'error'

export interface ScanProgressEvent {
  type: 'progress'
  phase: ScanPhase
  message: string
}

export interface ScanLogEvent {
  type: 'log'
  source: string
  count: number
  message: string
  detail?: string[]
}

export interface ScanProposalData {
  id: string
  system: string
  kind?: ProposalKind
  tier: number
  summary: string
  detail?: string
  draft?: string
  url?: string
  externalId?: string
  sourceMessageIds?: string[]
  confidence?: number
  risk?: string
  /** Originální zpráva, která vyvolala návrh (např. email nebo Slack zpráva) */
  originalMessage?: string
  /** ISO 8601 čas zdrojové události (přijetí e-mailu nebo odeslání Slack zprávy) */
  sourceOccurredAt?: string
  /** Detekovaný Jira issue key (např. "PROJ-123") */
  issueKey?: string
  /** Detekovaný Jira project key (např. "PROJ") */
  projectKey?: string
  /** Detekovaný název klienta/firmy */
  detectedClient?: string
  /** ID existujícího klienta v DB, pokud byl namatchován při klasifikaci */
  detectedClientId?: string
  /** Google Calendar event ID, pokud návrh souvisí s událostí */
  calendarEventId?: string
  /** Status návrhu (k dispozici u návrhů načtených z API) */
  status?: ProposalStatus
  /** ID uživatele vlastnícího návrh (k dispozici u návrhů načtených z API) */
  userId?: string
}

export interface ScanProposalEvent {
  type: 'proposal'
  proposal: ScanProposalData
}

export interface ScanSummary {
  tierCounts: Record<number, number>
  totalItems: number
  proposalCount: number
  sources: Record<string, number>
  proposalCountsBySource?: Record<string, number>
  deduplicatedCount?: number
  relevanceFilteredCount?: number
  relevanceRejected?: Record<string, number>
  sourceErrors?: Record<string, string>
}

export interface AutoReadSuggestionItem {
  messageId: string
  subject: string
  from: string
  receivedAt: string
}

export interface ScanAutoReadSuggestionsEvent {
  type: 'auto_read_suggestions'
  items: AutoReadSuggestionItem[]
}

export interface ScanCompletedEvent {
  type: 'completed'
  scanRunId: string
  summary: ScanSummary
}

export interface ScanErrorEvent {
  type: 'error'
  message: string
}

export type ScanRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface ScanStatusSnapshot {
  scanRunId: string
  status: ScanRunStatus
  phase: ScanPhase
  message: string | null
  startedAt: string
  completedAt: string | null
  summary: ScanSummary | null
  proposals: ScanProposalData[]
  autoReadSuggestions: AutoReadSuggestionItem[]
}

export interface ScanStatusResponse {
  scan: ScanStatusSnapshot | null
}

export type ScanEvent =
  | ScanProgressEvent
  | ScanLogEvent
  | ScanProposalEvent
  | ScanAutoReadSuggestionsEvent
  | ScanCompletedEvent
  | ScanErrorEvent

// ─── Proposal types ───────────────────────────────────────────────────────────

export interface Proposal extends ScanProposalData {
  scanRunId: string | null
  userId: string
  status: ProposalStatus
  createdAt: string
  updatedAt: string
}

/** Creates a proposal from a connector message without accepting message content from the client. */
export type CreateProposalFromSourceMessageRequest =
  | {
    source: 'gmail'
    messageId: string
  }
  | {
    source: 'slack'
    channelId: string
    ts: string
  }

export interface ProposalsListResponse {
  proposals: Proposal[]
}
