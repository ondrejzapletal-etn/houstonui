import { create } from 'zustand'
import type { UserProfile } from '@houston/shared-types'

export interface AuthStore {
  // State
  isAuthenticated: boolean
  user: UserProfile | null
  /** Access token – POUZE v paměti, nikdy do localStorage/sessionStorage */
  accessToken: string | null
  expiresAt: number | null // Unix timestamp (ms)

  // Actions
  setAuth: (token: string, user: UserProfile, expiresIn: number) => void
  clearAuth: () => void
  isTokenExpired: () => boolean
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  isAuthenticated: false,
  user: null,
  accessToken: null,
  expiresAt: null,

  setAuth: (token, user, expiresIn) => {
    set({
      isAuthenticated: true,
      user,
      accessToken: token,
      expiresAt: Date.now() + expiresIn * 1000,
    })
  },

  clearAuth: () => {
    set({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      expiresAt: null,
    })
  },

  isTokenExpired: () => {
    const { expiresAt } = get()
    if (!expiresAt) return true
    return Date.now() >= expiresAt
  },
}))
