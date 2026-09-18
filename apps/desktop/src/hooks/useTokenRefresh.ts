import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { restoreSession } from '../services/authClient'
import type { UserProfile } from '@houston/shared-types'

const REFRESH_BEFORE_EXPIRY_MS = 2 * 60 * 1000 // 2 minuty před expirací

/**
 * Automatický refresh access tokenu.
 *
 * Access token žije 15 minut, session cookie 30 dní. Dva timery před expirací
 * vyměníme httpOnly cookie za nový access token přes GET /auth/session – tedy
 * přesně to, co dělá restoreSession() při startu aplikace. Žádný nový backend
 * endpoint není potřeba.
 *
 * Pokud cookie chybí nebo je expirovaná, restoreSession() vrátí null a
 * uživatele odhlásíme – to je jediná cesta k clearAuth().
 */
export function useTokenRefresh() {
  const { expiresAt, setAuth, clearAuth } = useAuthStore()

  useEffect(() => {
    if (!expiresAt) return

    const timeUntilRefresh = expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS

    // Token už expiroval nebo expiruje dřív, než by timer stihl doběhnout –
    // zkus obnovit hned.
    const delay = Math.max(0, timeUntilRefresh)

    const timer = setTimeout(async () => {
      const result = await restoreSession().catch(() => null)

      if (!result) {
        clearAuth()
        return
      }

      const user: UserProfile = {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
      }
      setAuth(result.accessToken, user, result.expiresIn)
    }, delay)

    return () => clearTimeout(timer)
  }, [expiresAt, setAuth, clearAuth])
}
