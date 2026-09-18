import { API_BASE_URL } from '../config/api'
import type { JiraIssueDto } from '@houston/shared-types'

function authHeader(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function updateIssue(
  accessToken: string | null | undefined,
  id: string,
  body: Partial<Pick<JiraIssueDto, 'summary' | 'active'>>,
): Promise<JiraIssueDto> {
  const response = await fetch(`${API_BASE_URL}/issues/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(accessToken),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Issue update failed: ${response.status}`)
  const json = (await response.json()) as { data: { issue: JiraIssueDto } }
  return json.data.issue
}
