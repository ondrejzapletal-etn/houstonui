import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchAiSettings, fetchAiUsage, fetchTimeSaved, updateAiSettings } from './settingsClient'
import type { AiSettings, AiUsageSummary, TimeSavedSummary } from '@houston/shared-types'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

const settings: AiSettings = {
  aiProvider: 'ANTHROPIC',
  effectiveProvider: 'ANTHROPIC',
  systemDefault: 'OPENAI',
  models: { fast: 'claude-haiku-4-5', high: 'claude-sonnet-5' },
  availableProviders: ['OPENAI', 'ANTHROPIC'],
}

const ok = (data: unknown) => ({ ok: true, json: async () => data })
const fail = (status: number, text = 'boom') => ({
  ok: false,
  status,
  text: async () => text,
})

describe('fetchAiSettings', () => {
  it('returns the settings and sends the bearer token', async () => {
    mockFetch.mockResolvedValueOnce(ok(settings))

    expect(await fetchAiSettings('token-abc')).toEqual(settings)

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toMatch(/\/settings\/ai$/)
    expect(init.headers.Authorization).toBe('Bearer token-abc')
  })

  it('omits the auth header when there is no token', async () => {
    mockFetch.mockResolvedValueOnce(ok(settings))

    await fetchAiSettings('')

    expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
  })

  it('throws with the status and body on a failed response', async () => {
    mockFetch.mockResolvedValueOnce(fail(401, 'Unauthorized'))

    await expect(fetchAiSettings('token-abc')).rejects.toThrow(/HTTP 401 — Unauthorized/)
  })
})

const usage: AiUsageSummary = {
  daily: [
    { period: '2026-08-31', inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001, hasUnknownPricing: false },
  ],
  monthly: [
    { period: '2026-08', inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001, hasUnknownPricing: false },
  ],
}

describe('fetchAiUsage', () => {
  it('returns the usage summary and sends the bearer token', async () => {
    mockFetch.mockResolvedValueOnce(ok(usage))

    expect(await fetchAiUsage('token-abc')).toEqual(usage)

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toMatch(/\/settings\/ai\/usage$/)
    expect(init.headers.Authorization).toBe('Bearer token-abc')
  })

  it('throws with the status and body on a failed response', async () => {
    mockFetch.mockResolvedValueOnce(fail(401, 'Unauthorized'))

    await expect(fetchAiUsage('token-abc')).rejects.toThrow(/HTTP 401 — Unauthorized/)
  })
})

const timeSaved: TimeSavedSummary = {
  daily: [
    {
      period: '2026-08-31',
      counts: { scan: 2, processed_message: 1, auto_read: 5, mark_read: 0, worklog: 3 },
    },
  ],
  monthly: [
    {
      period: '2026-08',
      counts: { scan: 10, processed_message: 4, auto_read: 20, mark_read: 2, worklog: 15 },
    },
  ],
}

describe('fetchTimeSaved', () => {
  it('returns the time-saved summary and sends the bearer token', async () => {
    mockFetch.mockResolvedValueOnce(ok(timeSaved))

    expect(await fetchTimeSaved('token-abc')).toEqual(timeSaved)

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toMatch(/\/users\/me\/time-saved$/)
    expect(init.headers.Authorization).toBe('Bearer token-abc')
  })

  it('throws with the status and body on a failed response', async () => {
    mockFetch.mockResolvedValueOnce(fail(401, 'Unauthorized'))

    await expect(fetchTimeSaved('token-abc')).rejects.toThrow(/HTTP 401 — Unauthorized/)
  })
})

describe('updateAiSettings', () => {
  it('PUTs the provider and returns the refreshed settings', async () => {
    mockFetch.mockResolvedValueOnce(ok(settings))

    expect(await updateAiSettings('token-abc', { aiProvider: 'ANTHROPIC' })).toEqual(settings)

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toMatch(/\/settings\/ai$/)
    expect(init.method).toBe('PUT')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ aiProvider: 'ANTHROPIC' })
  })

  // null is the "follow the server default" case – it must survive serialisation.
  it('sends null to clear the choice', async () => {
    mockFetch.mockResolvedValueOnce(ok({ ...settings, aiProvider: null }))

    await updateAiSettings('token-abc', { aiProvider: null })

    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ aiProvider: null })
  })

  it('throws with the status and body on a failed response', async () => {
    mockFetch.mockResolvedValueOnce(fail(400, 'aiProvider must be OPENAI, ANTHROPIC or null'))

    await expect(updateAiSettings('token-abc', { aiProvider: 'OPENAI' })).rejects.toThrow(
      /HTTP 400/,
    )
  })
})
