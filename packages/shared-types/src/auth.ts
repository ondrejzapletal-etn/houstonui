// Profil přihlášeného uživatele
export interface UserProfile {
  id: string // interní DB id
  entraId?: string // object ID z Entra ID (jen pro Entra login)
  googleId?: string // Google ID (jen pro Google login)
  email: string
  displayName: string
}

// Výsledek úspěšného přihlášení
export interface LoginResponse {
  accessToken: string // JWT, krátkodobý (15 min)
  expiresIn: number // sekundy do expirace
  user: UserProfile
}

// Informace o aktuální session (vrací GET /auth/me)
export interface SessionInfo {
  user: UserProfile
  expiresAt: string // ISO 8601 datetime
}

// Chybové kódy pro auth doménu
export type AuthErrorCode =
  | 'AUTH_INVALID_TOKEN'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_UNAUTHORIZED'
  | 'AUTH_CALLBACK_FAILED'
  | 'AUTH_SESSION_NOT_FOUND'
