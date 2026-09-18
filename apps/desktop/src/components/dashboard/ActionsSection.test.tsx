import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActionsSection from './ActionsSection'
import { loadLastScan, useScanStream } from '../../services/scanService'

vi.mock('../../services/scanService', () => ({
  useScanStream: vi.fn(),
  loadLastScan: vi.fn(() => null),
}))

vi.mock('../../services/proposalsApi', () => ({
  fetchProposals: vi.fn().mockResolvedValue([]),
  batchMarkRead: vi.fn(),
}))

vi.mock('../../store/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({ language: 'cs' })),
}))

vi.mock('./ProposalCard', () => ({ ProposalCard: () => null }))
vi.mock('./ScanRocketProgressBar', () => ({ ScanRocketProgressBar: () => null }))
vi.mock('./TaskModal', () => ({ default: () => null }))
vi.mock('./AutoReadModal', () => ({ default: () => null }))

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ActionsSection />
    </QueryClientProvider>,
  )
}

describe('ActionsSection', () => {
  beforeEach(() => {
    vi.mocked(loadLastScan).mockReturnValue({
      proposals: [],
      autoReadSuggestions: [],
      summary: { tierCounts: { 3: 30 }, totalItems: 30, proposalCount: 0, sources: { gmail: 30 } },
      completedAt: '2026-09-25T09:56:00',
    })
    vi.mocked(useScanStream).mockReturnValue({
      scanState: {
        state: 'completed',
        phase: 'done',
        message: 'Scan completed.',
        logs: [],
        proposals: [],
        autoReadSuggestions: [{
          messageId: 'message-1',
          subject: 'Newsletter',
          from: 'news@example.com',
          receivedAt: '2026-09-03T08:00:00.000Z',
        }],
        summary: { tierCounts: { 3: 30 }, totalItems: 30, proposalCount: 0, sources: { gmail: 30 } },
        errorMessage: null,
      },
      start: vi.fn(),
      stop: vi.fn(),
      clearAutoReadSuggestions: vi.fn(),
      isRestoring: false,
    })
  })

  it('shows the bulk mark-read button when scan candidates exist', () => {
    renderSection()

    expect(screen.getByRole('button', { name: 'Označit přečtené (1)' })).toBeInTheDocument()
  })

  it('shows the completed scan timestamp and counts', async () => {
    renderSection()

    expect(await screen.findByText(
      'Poslední scan: 9:56 25.9.2026 | 30 položek klasifikováno | 0 návrhů.',
    )).toBeInTheDocument()
  })
})
