import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from './authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      expiresAt: null,
    })
  })

  it('initial state is unauthenticated', () => {
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
    expect(state.accessToken).toBeNull()
  })

  it('setAuth stores token and user in memory', () => {
    const user = { id: '1', entraId: 'e1', email: 'a@b.com', displayName: 'A' }
    useAuthStore.getState().setAuth('jwt-token', user, 900)

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.accessToken).toBe('jwt-token')
    expect(state.user).toEqual(user)
    expect(state.expiresAt).toBeGreaterThan(Date.now())
  })

  it('clearAuth resets all state', () => {
    const user = { id: '1', entraId: 'e1', email: 'a@b.com', displayName: 'A' }
    useAuthStore.getState().setAuth('jwt-token', user, 900)
    useAuthStore.getState().clearAuth()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.accessToken).toBeNull()
  })

  it('isTokenExpired returns true for expired token', () => {
    useAuthStore.setState({ expiresAt: Date.now() - 1000 })
    expect(useAuthStore.getState().isTokenExpired()).toBe(true)
  })

  it('isTokenExpired returns false for valid token', () => {
    useAuthStore.setState({ expiresAt: Date.now() + 900_000 })
    expect(useAuthStore.getState().isTokenExpired()).toBe(false)
  })

  it('token is never persisted to localStorage or sessionStorage', () => {
    const localSetSpy = vi.spyOn(Storage.prototype, 'setItem')
    const sessionSetSpy = vi.spyOn(Storage.prototype, 'setItem')

    const user = { id: '1', entraId: 'e1', email: 'a@b.com', displayName: 'A' }
    useAuthStore.getState().setAuth('jwt-token', user, 900)

    // Žádný setItem nesmí být volán – token zůstává pouze v paměti
    expect(localSetSpy).not.toHaveBeenCalled()
    expect(sessionSetSpy).not.toHaveBeenCalled()

    localSetSpy.mockRestore()
    sessionSetSpy.mockRestore()
  })

  it('store is not using persist middleware', () => {
    // Zustand persist middleware přidává klíč do storage při init
    // Ověřujeme že žádný 'houston' ani 'auth' klíč není v localStorage
    expect(localStorage.getItem('houston-auth')).toBeNull()
    expect(localStorage.getItem('auth-storage')).toBeNull()
    expect(localStorage.getItem('auth')).toBeNull()
  })
})
