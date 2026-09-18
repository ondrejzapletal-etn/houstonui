import { API_BASE_URL } from '../config/api'

export interface LoginUrlResult {
  authUrl: string
  state: string
}

/**
 * Validuje, že URL je bezpečná Entra ID login URL (HTTPS, správná doména)
 */
function validateAuthUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid authorization URL received from server')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Authorization URL must use HTTPS')
  }

  // Entra ID musí být na *.microsoftonline.com nebo přesně microsoftonline.com
  const hostname = parsed.hostname.toLowerCase()
  const isValidHost =
    hostname === 'microsoftonline.com' || hostname.endsWith('.microsoftonline.com')
  if (!isValidHost) {
    throw new Error('Authorization URL must be from microsoftonline.com')
  }

  return parsed
}

/**
 * Iniciuje OAuth login flow – získá authorization URL z backendu
 */
export async function initiateLogin(): Promise<LoginUrlResult> {
  const response = await fetch(`${API_BASE_URL}/auth/login`)

  if (!response.ok) {
    throw new Error(`Login initiation failed: ${response.status}`)
  }

  const json: unknown = await response.json()

  // Runtime validace response shape
  if (
    typeof json !== 'object' ||
    json === null ||
    !('success' in json) ||
    !(json as Record<string, unknown>).success ||
    !('data' in json)
  ) {
    throw new Error('Invalid response from server')
  }

  const data = (json as Record<string, unknown>).data
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as Record<string, unknown>).authUrl !== 'string' ||
    typeof (data as Record<string, unknown>).state !== 'string'
  ) {
    throw new Error('Invalid login data from server')
  }

  const authUrl = (data as Record<string, unknown>).authUrl as string
  const state = (data as Record<string, unknown>).state as string

  // Validace URL bezpečnosti
  validateAuthUrl(authUrl)

  return { authUrl, state }
}

/**
 * Provede logout na backendu
 */
export async function performLogout(accessToken: string): Promise<void> {
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // Fire-and-forget: chyby ignorujeme
}

export interface RestoreSessionResult {
  accessToken: string
  expiresIn: number
  user: { id: string; email: string; displayName: string }
}

/**
 * Pokusí se obnovit session z httpOnly cookie (volejte při startu aplikace).
 * Vrátí null pokud cookie neexistuje nebo je expirovaná.
 */
export async function restoreSession(): Promise<RestoreSessionResult | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/session`, {
      credentials: 'include', // odešle httpOnly cookie
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      success: boolean
      data?: RestoreSessionResult
    }
    return json.success && json.data ? json.data : null
  } catch {
    return null
  }
}
