/** SSE event types emitted on GET /api/v1/scan/stream (see docs/04-api-contracts.md) */

export type ScanEventType = 'progress' | 'log' | 'proposal' | 'auto_read_suggestions' | 'completed' | 'error'

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

export interface ScanProposalEvent {
  type: 'proposal'
  proposal: {
    id: string
    system: string
    kind?: 'MESSAGE_REPLY' | 'DOCUMENT_REVIEW'
    tier: number
    summary: string
    detail?: string
    draft?: string
    url?: string
    externalId?: string
    sourceMessageIds?: string[]
    confidence?: number
    risk?: string
    originalMessage?: string
    sourceOccurredAt?: string
    issueKey?: string
    projectKey?: string
    detectedClient?: string
    detectedClientId?: string
    calendarEventId?: string
  }
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
  summary: {
    tierCounts: Record<number, number>
    totalItems: number
    proposalCount: number
    sources: Record<string, number>
  }
}

export interface ScanErrorEvent {
  type: 'error'
  message: string
}

export type ScanEvent =
  | ScanProgressEvent
  | ScanLogEvent
  | ScanProposalEvent
  | ScanAutoReadSuggestionsEvent
  | ScanCompletedEvent
  | ScanErrorEvent
