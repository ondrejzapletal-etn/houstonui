import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuth } from './useAuth'
import { useAuthStore } from '../store/authStore'
import type { UserProfile } from '@houston/shared-types'

// Mock authClient so performLogout doesn't make real HTTP calls
vi.mock('../services/authClient', () => ({
  performLogout: vi.fn().mockResolvedValue(undefined),
}))

const mockUser: UserProfile = {
  id: '1',
  entraId: 'entra-123',
  email: 'test@example.com',
  displayName: 'Test User',
}

beforeEach(() => {
  // Reset Zustand store to initial state between tests
  useAuthStore.setState({
    isAuthenticated: false,
    user: null,
    accessToken: null,
    expiresAt: null,
  })
})

describe('useAuth', () => {
  it('starts unauthenticated', () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
    expect(result.current.accessToken).toBeNull()
  })

  it('sets authenticated state after login', () => {
    const { result } = renderHook(() => useAuth())

    act(() => {
      result.current.login('token-abc', mockUser)
    })

    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user).toEqual(mockUser)
    expect(result.current.accessToken).toBe('token-abc')
  })

  it('clears state after logout', async () => {
    const { result } = renderHook(() => useAuth())

    act(() => {
      result.current.login('token-abc', mockUser)
    })
    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
    expect(result.current.accessToken).toBeNull()
  })

  it('notifies all hook instances on login', () => {
    const { result: hook1 } = renderHook(() => useAuth())
    const { result: hook2 } = renderHook(() => useAuth())

    act(() => {
      hook1.current.login('token-xyz', mockUser)
    })

    // Zustand propagates to all subscribers
    expect(hook2.current.isAuthenticated).toBe(true)
    expect(hook2.current.user).toEqual(mockUser)
  })

  it('exposes isTokenExpired function from store', () => {
    const { result } = renderHook(() => useAuth())
    // No token set → expired
    expect(result.current.isTokenExpired()).toBe(true)

    act(() => {
      result.current.login('token-abc', mockUser, 900)
    })
    // Fresh token → not expired
    expect(result.current.isTokenExpired()).toBe(false)
  })

  it('calls performLogout with token on logout', async () => {
    const { performLogout } = await import('../services/authClient')
    const { result } = renderHook(() => useAuth())

    act(() => {
      result.current.login('my-token', mockUser)
    })
    await act(async () => {
      await result.current.logout()
    })

    expect(performLogout).toHaveBeenCalledWith('my-token')
  })
})
