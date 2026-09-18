import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScanStream } from './scanService'
import { useAuthStore } from '../store/authStore'

function ScanStateProbe() {
  const { scanState, isRestoring } = useScanStream()

  return (
    <div>
      <span data-testid="restoring">{String(isRestoring)}</span>
      <span data-testid="state">{scanState.state}</span>
      <span data-testid="phase">{scanState.phase}</span>
      <span data-testid="message">{scanState.message}</span>
      <span data-testid="proposals">{scanState.proposals.length}</span>
      <span data-testid="auto-read">{scanState.autoReadSuggestions.length}</span>
      <span data-testid="logs">{scanState.logs.join('\n')}</span>
    </div>
  )
}

describe('useScanStream', () => {
  beforeEach(() => {
    act(() => useAuthStore.setState({ accessToken: 'test-token' }))
  })

  afterEach(() => {
    act(() => useAuthStore.setState({ accessToken: null }))
    vi.unstubAllGlobals()
  })

  it('restores a running scan from the server after a page reload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        scan: {
          scanRunId: 'scan-1',
          status: 'RUNNING',
          phase: 'classify',
          message: 'Classifying items with AI...',
          startedAt: '2026-09-01T08:00:00.000Z',
          completedAt: null,
          summary: null,
          proposals: [{ id: 'proposal-1', system: 'gmail', tier: 1, summary: 'Reply to client' }],
          autoReadSuggestions: [],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ScanStateProbe />)

    await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('false'))
    expect(screen.getByTestId('state')).toHaveTextContent('running')
    expect(screen.getByTestId('phase')).toHaveTextContent('classify')
    expect(screen.getByTestId('message')).toHaveTextContent('Classifying items with AI...')
    expect(screen.getByTestId('proposals')).toHaveTextContent('1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/scan/status'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
  })

  it('restores and persists auto-read suggestions from a completed scan', async () => {
    const suggestion = {
      messageId: 'message-1',
      subject: 'Newsletter',
      from: 'news@example.com',
      receivedAt: '2026-09-03T08:00:00.000Z',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        scan: {
          scanRunId: 'scan-2',
          status: 'COMPLETED',
          phase: 'done',
          message: 'Scan completed.',
          startedAt: '2026-09-03T08:00:00.000Z',
          completedAt: '2026-09-03T08:01:00.000Z',
          summary: { tierCounts: { 3: 1 }, totalItems: 1, proposalCount: 0, sources: { gmail: 1 } },
          proposals: [],
          autoReadSuggestions: [suggestion],
        },
      }),
    }))

    render(<ScanStateProbe />)

    await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('false'))
    expect(screen.getByTestId('state')).toHaveTextContent('completed')
    expect(screen.getByTestId('auto-read')).toHaveTextContent('1')
    expect(screen.getByTestId('logs')).toBeEmptyDOMElement()
    expect(JSON.parse(localStorage.getItem('houston_last_scan') ?? '{}')).toEqual(expect.objectContaining({
      autoReadSuggestions: [suggestion],
    }))
  })
})
