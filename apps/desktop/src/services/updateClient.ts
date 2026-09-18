import { API_BASE_URL } from '../config/api'
import type { UpdateClientDto, ClientDto } from '@houston/shared-types'

function authHeader(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function updateClient(
  accessToken: string | null | undefined,
  id: string,
  body: UpdateClientDto,
): Promise<ClientDto> {
  const response = await fetch(`${API_BASE_URL}/clients/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(accessToken),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Client update failed: ${response.status}`)
  const json = (await response.json()) as { data: { client: ClientDto } }
  return json.data.client
}
