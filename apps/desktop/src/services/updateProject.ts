import { API_BASE_URL } from '../config/api'
import type { UpdateProjectDto, ProjectDto } from '@houston/shared-types'

function authHeader(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function updateProject(
  accessToken: string | null | undefined,
  id: string,
  body: UpdateProjectDto,
): Promise<ProjectDto> {
  const response = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(accessToken),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Project update failed: ${response.status}`)
  const json = (await response.json()) as { data: { project: ProjectDto } }
  return json.data.project
}
