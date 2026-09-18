import { API_BASE_URL } from '../config/api'
import type { ContextData, ContextResponse } from '@houston/shared-types'

/**
 * Fetches aggregated context data from all connected sources.
 *
 * GET /api/v1/context
 */
export async function fetchContext(accessToken: string): Promise<ContextData> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const response = await fetch(`${API_BASE_URL}/context`, { headers })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Context fetch failed: HTTP ${response.status} — ${text}`)
  }

  const json = (await response.json()) as ContextResponse
  return json.data
}
