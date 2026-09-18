export interface TaskProgressEvent {
  type: 'progress'
  phase: string
  message: string
}

export interface TaskLogEvent {
  type: 'log'
  message: string
}

export interface TaskResultEvent {
  type: 'result'
  content: string
}

export interface TaskProposalEvent {
  type: 'proposal'
  proposal: {
    id: string
    system: string
    tier: number
    summary: string
    detail?: string
    draft?: string
    url?: string
    externalId?: string
    confidence?: number
    risk?: string
    issueKey?: string
  }
}

export interface TaskCompletedEvent {
  type: 'completed'
  summary: {
    proposalCount: number
  }
}

export interface TaskErrorEvent {
  type: 'error'
  message: string
}

export type TaskEvent =
  | TaskProgressEvent
  | TaskLogEvent
  | TaskResultEvent
  | TaskProposalEvent
  | TaskCompletedEvent
  | TaskErrorEvent
