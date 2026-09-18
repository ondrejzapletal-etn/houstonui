import { API_BASE_URL } from '../config/api'
import type { AiSettings, AiUsageReport, AiUsageSummary, ReportRange, TimeSavedReport, TimeSavedSummary, UpdateAiSettingsRequest } from '@houston/shared-types'

function authHeaders(accessToken: string, json = false): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (json) headers['Content-Type'] = 'application/json'
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  return headers
}

/**
 * Fetches the user's server-side AI settings.
 *
 * GET /api/v1/settings/ai
 */
export async function fetchAiSettings(accessToken: string): Promise<AiSettings> {
  const response = await fetch(`${API_BASE_URL}/settings/ai`, {
    headers: authHeaders(accessToken),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AI settings fetch failed: HTTP ${response.status} — ${text}`)
  }

  return (await response.json()) as AiSettings
}

/**
 * Fetches the user's LLM token/cost usage: last 7 days, last 3 months.
 *
 * GET /api/v1/settings/ai/usage
 */
export async function fetchAiUsage(accessToken: string): Promise<AiUsageSummary> {
  const response = await fetch(`${API_BASE_URL}/settings/ai/usage`, {
    headers: authHeaders(accessToken),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AI usage fetch failed: HTTP ${response.status} — ${text}`)
  }

  return (await response.json()) as AiUsageSummary
}

export async function fetchAiUsageReport(
  accessToken: string,
  range: ReportRange,
): Promise<AiUsageReport> {
  const query = new URLSearchParams({
    from: range.from,
    to: range.to,
    granularity: range.granularity,
  }).toString()
  const response = await fetch(`${API_BASE_URL}/settings/ai/usage/range?${query}`, {
    headers: authHeaders(accessToken),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AI usage report fetch failed: HTTP ${response.status} — ${text}`)
  }

  return (await response.json()) as AiUsageReport
}

/**
 * Fetches the user's time-saved action counts: last 7 days, last 3 months.
 * Counts only – seconds are computed client-side from the coefficients
 * in the settings store.
 *
 * GET /api/v1/users/me/time-saved
 */
export async function fetchTimeSaved(accessToken: string): Promise<TimeSavedSummary> {
  const response = await fetch(`${API_BASE_URL}/users/me/time-saved`, {
    headers: authHeaders(accessToken),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Time-saved fetch failed: HTTP ${response.status} — ${text}`)
  }

  return (await response.json()) as TimeSavedSummary
}

export async function fetchTimeSavedReport(
  accessToken: string,
  range: ReportRange,
): Promise<TimeSavedReport> {
  const query = new URLSearchParams({
    from: range.from,
    to: range.to,
    granularity: range.granularity,
  }).toString()
  const response = await fetch(`${API_BASE_URL}/users/me/time-saved/range?${query}`, {
    headers: authHeaders(accessToken),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Time-saved report fetch failed: HTTP ${response.status} — ${text}`)
  }

  return (await response.json()) as TimeSavedReport
}

/**
 * Saves the user's AI provider choice. `null` reverts to the server default.
 *
 * PUT /api/v1/settings/ai
 */
export async function updateAiSettings(
  accessToken: string,
  body: UpdateAiSettingsRequest,
): Promise<AiSettings> {
  const response = await fetch(`${API_BASE_URL}/settings/ai`, {
    method: 'PUT',
    headers: authHeaders(accessToken, true),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`AI settings update failed: HTTP ${response.status} — ${text}`)
  }

  return (await response.json()) as AiSettings
}
