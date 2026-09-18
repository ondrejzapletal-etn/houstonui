import { ProposalStatus } from '@prisma/client'

export class ProposalResponseDto {
  id!: string
  scanRunId!: string
  userId!: string
  system!: string
  tier!: number
  summary!: string
  detail?: string
  draft?: string
  url?: string
  externalId?: string
  status!: ProposalStatus
  confidence?: number
  risk?: string
  /** Project associated with this proposal (if resolved) */
  projectId?: string
  /** Jira issue key associated with this proposal (e.g. "PROJ-123") */
  issueKey?: string
  /** ISO 8601 time when the triggering source event occurred */
  sourceOccurredAt?: string
  createdAt!: string
  updatedAt!: string
}
