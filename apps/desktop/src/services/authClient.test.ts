import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initiateLogin } from './authClient'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

describe('initiateLogin', () => {
  it('vrátí authUrl a state při úspěšné response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          authUrl: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?foo=bar',
          state: 'abc123',
        },
      }),
    })

    const result = await initiateLogin()
    expect(result.authUrl).toContain('microsoftonline.com')
    expect(result.state).toBe('abc123')
  })

  it('vyhodí chybu při non-HTTPS authUrl', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          authUrl: 'http://evil.com/auth',
          state: 'abc',
        },
      }),
    })

    await expect(initiateLogin()).rejects.toThrow('HTTPS')
  })

  it('vyhodí chybu při javascript: authUrl', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          authUrl: 'javascript:alert(1)',
          state: 'abc',
        },
      }),
    })

    await expect(initiateLogin()).rejects.toThrow()
  })

  it('vyhodí chybu při nevalidní URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          authUrl: 'not-a-url',
          state: 'abc',
        },
      }),
    })

    await expect(initiateLogin()).rejects.toThrow()
  })

  it('vyhodí chybu při chybějícím authUrl v response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { state: 'abc' }, // chybí authUrl
      }),
    })

    await expect(initiateLogin()).rejects.toThrow('Invalid login data')
  })

  it('vyhodí chybu při HTTP chybě', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(initiateLogin()).rejects.toThrow('Login initiation failed')
  })

  it('vyhodí chybu při success: false v těle response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: false,
        error: { message: 'Auth disabled' },
      }),
    })

    await expect(initiateLogin()).rejects.toThrow('Invalid response from server')
  })

  it('odmítne URL z jiné domény než microsoftonline.com', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          authUrl: 'https://phishing.example.com/auth',
          state: 'xyz',
        },
      }),
    })

    await expect(initiateLogin()).rejects.toThrow('microsoftonline.com')
  })

  it('vyhodí chybu při suffix-bypass doméně (evilmicrosoftonline.com)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          authUrl: 'https://evilmicrosoftonline.com/auth',
          state: 'abc',
        },
      }),
    })

    await expect(initiateLogin()).rejects.toThrow()
  })
})
