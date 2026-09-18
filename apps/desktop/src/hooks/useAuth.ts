import { useCallback } from 'react'
import { useAuthStore } from '../store/authStore'
import { performLogout } from '../services/authClient'
import type { UserProfile } from '@houston/shared-types'

export function useAuth() {
  const store = useAuthStore()

  const login = useCallback(
    (token: string, user: UserProfile, expiresIn = 900) => {
      store.setAuth(token, user, expiresIn)
    },
    [store],
  )

  const logout = useCallback(async () => {
    const { accessToken } = useAuthStore.getState()
    if (accessToken) {
      await performLogout(accessToken).catch(() => {})
    }
    store.clearAuth()
  }, [store])

  return {
    isAuthenticated: store.isAuthenticated,
    user: store.user,
    accessToken: store.accessToken,
    isTokenExpired: store.isTokenExpired,
    login,
    logout,
  }
}
