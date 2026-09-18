import { API_BASE_URL } from '../config/api'
import type { Proposal, ProposalsListResponse } from '@houston/shared-types'
import { useAuthStore } from '../store/authStore'

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
