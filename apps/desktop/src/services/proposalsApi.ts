import { API_BASE_URL } from '../config/api'
import type {
  CreateProposalFromSourceMessageRequest,
  Proposal,
  ProposalsListResponse,
} from '@houston/shared-types'
import { useAuthStore } from '../store/authStore'

export const PROPOSALS_QUERY_KEY = ['proposals'] as const
export const PROPOSAL_CREATED_EVENT = 'houston:proposal-created'

export async function batchMarkRead(
  messageIds: string[],
): Promise<{ markedCount: number; autoReadCount: number }> {
  const accessToken = useAuthStore.getState().accessToken
  const res = await fetch(`${API_BASE_URL}/gmail/batch-mark-read`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ messageIds }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { success: boolean; data: { markedCount: number; autoReadCount: number } }
  return json.data
}

export async function fetchProposals(): Promise<Proposal[]> {
  // Získat access token přímo z auth store (mimo React hook)
  const accessToken = useAuthStore.getState().accessToken
  const res = await fetch(`${API_BASE_URL}/proposals`, {
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { success: boolean; data: ProposalsListResponse }
  return json.data.proposals
}

export async function createProposalFromSourceMessage(
  request: CreateProposalFromSourceMessageRequest,
): Promise<Proposal> {
  const accessToken = useAuthStore.getState().accessToken
  const res = await fetch(`${API_BASE_URL}/proposals/from-source-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(request),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => null) as { message?: unknown; error?: { message?: unknown } } | null
    const message = typeof error?.message === 'string'
      ? error.message
      : typeof error?.error?.message === 'string'
        ? error.error.message
        : `HTTP ${res.status}`
    throw new Error(message)
  }
  const json = (await res.json()) as { success: boolean; data: { proposal: Proposal } }
  return json.data.proposal
}
