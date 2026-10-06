import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActionsSection from './ActionsSection'
import { loadLastScan, useScanStream } from '../../services/scanService'
import { fetchProposals } from '../../services/proposalsApi'
import { useAuthStore } from '../../store/authStore'

vi.mock('../../services/scanService', () => ({
  useScanStream: vi.fn(),
  loadLastScan: vi.fn(() => null),
}))

vi.mock('../../services/proposalsApi', () => ({
  fetchProposals: vi.fn().mockResolvedValue([]),
  batchMarkRead: vi.fn(),
  PROPOSALS_QUERY_KEY: ['proposals'],
  PROPOSAL_CREATED_EVENT: 'houston:proposal-created',
}))

vi.mock('../../store/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({ language: 'cs' })),
}))

vi.mock('./ProposalCard', () => ({ ProposalCard: ({ proposal }: { proposal: { summary: string } }) => <p>{proposal.summary}</p> }))
vi.mock('./ScanRocketProgressBar', () => ({ ScanRocketProgressBar: () => null }))
vi.mock('./TaskModal', () => ({ default: () => null }))
vi.mock('./AutoReadModal', () => ({ default: () => null }))

function renderSection(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ActionsSection />
    </QueryClientProvider>,
  )
}

describe('ActionsSection', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 'test-token',
      isAuthenticated: true,
      user: { id: 'user-1', email: 'user@example.com', displayName: 'User' },
    })
    vi.mocked(fetchProposals).mockReset().mockResolvedValue([])
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
    const currentScan = vi.mocked(useScanStream)()
    vi.mocked(useScanStream).mockReturnValue({
      ...currentScan,
      scanState: {
        ...currentScan.scanState,
        summary: {
          tierCounts: { 1: 4, 2: 3, 3: 23 },
          totalItems: 30,
          proposalCount: 2,
          sources: { gmail: 30, slack: 12, calendar: 4 },
          proposalCountsBySource: { gmail: 1, slack: 1 },
          deduplicatedCount: 5,
          relevanceFilteredCount: 2,
          relevanceRejected: { not_addressed: 2 },
          sourceErrors: {},
        },
      },
    })
    renderSection()

    expect(await screen.findByText('Poslední scan: 9:56 25.9.2026')).toBeInTheDocument()
    expect(screen.getByText('Vytvořeno').parentElement).toHaveTextContent('Vytvořeno2')
    expect(screen.getByText('Duplicity / sloučeno').parentElement).toHaveTextContent('Duplicity / sloučeno5')
    expect(screen.getByText('Vytvořeno podle zdroje:')).toHaveTextContent('Vytvořeno podle zdroje:')
    expect(screen.getByText(/Gmail: 1 · Slack: 1/)).toBeInTheDocument()
    expect(screen.getByText(/neadresováno uživateli: 2/)).toBeInTheDocument()
  })

  it('invalidates persisted proposals after a scan completes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderSection(queryClient)

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['proposals'],
    }))
  })

  it('loads proposals after the access token is restored', async () => {
    useAuthStore.setState({ accessToken: null, isAuthenticated: false, user: null })
    vi.mocked(fetchProposals).mockResolvedValue([{
      id: 'persisted-1', scanRunId: 'scan-run', userId: 'user-1', system: 'gmail', tier: 1,
      summary: 'Návrh po obnovení přihlášení', status: 'PENDING',
      createdAt: '2026-09-29T08:03:11.949Z', updatedAt: '2026-09-29T08:03:11.949Z',
    }])
    renderSection()

    expect(fetchProposals).not.toHaveBeenCalled()

    act(() => {
      useAuthStore.setState({
        accessToken: 'restored-token',
        isAuthenticated: true,
        user: { id: 'user-1', email: 'user@example.com', displayName: 'User' },
      })
    })

    expect(await screen.findByText('Návrh po obnovení přihlášení')).toBeInTheDocument()
  })

  it('keeps a newly created proposal visible ahead of older scan proposals in the same tier', async () => {
    const scanProposals = Array.from({ length: 10 }, (_, index) => ({
      id: `scan-${index}`,
      system: 'gmail',
      tier: 2,
      summary: `Starší návrh ${index}`,
    }))
    vi.mocked(loadLastScan).mockReturnValue({
      proposals: scanProposals,
      autoReadSuggestions: [],
      summary: { tierCounts: { 2: 10 }, totalItems: 10, proposalCount: 10, sources: { gmail: 10 } },
      completedAt: '2026-09-25T09:56:00',
    })
    vi.mocked(fetchProposals).mockResolvedValue([
      ...scanProposals.map((proposal) => ({
        ...proposal,
        scanRunId: 'scan-run',
        userId: 'user-1',
        status: 'PENDING' as const,
        createdAt: '2026-09-20T09:00:00.000Z',
        updatedAt: '2026-09-20T09:00:00.000Z',
      })),
      {
        id: 'manual-1', scanRunId: null, userId: 'user-1', system: 'gmail', tier: 2,
        summary: 'Nově vytvořený návrh', status: 'PENDING' as const,
        createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z',
      },
    ])

    renderSection()

    expect(await screen.findByText('Nově vytvořený návrh')).toBeInTheDocument()
  })

  it('sorts a manually created proposal ahead of a higher-tier scan proposal', async () => {
    vi.mocked(loadLastScan).mockReturnValue({
      proposals: [{ id: 'scan-1', system: 'gmail', tier: 1, summary: 'Scan tier 1' }],
      autoReadSuggestions: [],
      summary: { tierCounts: { 1: 1 }, totalItems: 1, proposalCount: 1, sources: { gmail: 1 } },
      completedAt: '2026-09-25T09:56:00',
    })
    vi.mocked(fetchProposals).mockResolvedValue([
      {
        id: 'scan-1', scanRunId: 'scan-run', userId: 'user-1', system: 'gmail', tier: 1,
        summary: 'Scan tier 1', status: 'PENDING', createdAt: '2026-09-20T09:00:00.000Z', updatedAt: '2026-09-20T09:00:00.000Z',
      },
      {
        id: 'manual-1', scanRunId: null, userId: 'user-1', system: 'gmail', tier: 2,
        summary: 'Ruční tier 2', status: 'PENDING', createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z',
      },
    ])

    renderSection()

    const firstProposal = await screen.findByText('Ruční tier 2')
    expect(firstProposal.compareDocumentPosition(screen.getByText('Scan tier 1'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('keeps proposals from the completed scan on the first page', async () => {
    const currentScan = vi.mocked(useScanStream)()
    vi.mocked(useScanStream).mockReturnValue({
      ...currentScan,
      scanState: {
        ...currentScan.scanState,
        proposals: [
          { id: 'current-1', system: 'gmail', tier: 2, summary: 'Aktuální návrh 1' },
          { id: 'current-2', system: 'gmail', tier: 2, summary: 'Aktuální návrh 2' },
        ],
      },
    })
    vi.mocked(fetchProposals).mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
      id: `older-${index}`,
      scanRunId: null,
      userId: 'user-1',
      system: 'gmail',
      tier: 2,
      summary: `Starší návrh ${index + 1}`,
      status: 'PENDING' as const,
      createdAt: `2026-09-${String(20 - index).padStart(2, '0')}T09:00:00.000Z`,
      updatedAt: '2026-09-20T09:00:00.000Z',
    })))

    renderSection()

    expect(await screen.findByText('Stránka 1 z 2')).toBeInTheDocument()
    const firstProposal = screen.getByText('Aktuální návrh 1')
    expect(screen.getByText('Aktuální návrh 2')).toBeInTheDocument()
    expect(firstProposal.compareDocumentPosition(screen.getByText('Starší návrh 1'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('paginates pending proposals after ten items', async () => {
    vi.mocked(fetchProposals).mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({
      id: `proposal-${index}`,
      scanRunId: null,
      userId: 'user-1',
      system: 'gmail',
      tier: 2,
      summary: `Návrh ${index + 1}`,
      status: 'PENDING' as const,
      createdAt: `2026-09-${String(20 - index).padStart(2, '0')}T09:00:00.000Z`,
      updatedAt: '2026-09-20T09:00:00.000Z',
    })))

    renderSection()

    expect(await screen.findByText('Návrh 1')).toBeInTheDocument()
    expect(screen.queryByText('Návrh 11')).not.toBeInTheDocument()
    expect(screen.getByText('Stránka 1 z 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Předchozí' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Další' }))

    expect(screen.getByText('Návrh 11')).toBeInTheDocument()
    expect(screen.getByText('Stránka 2 z 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Další' })).toBeDisabled()
  })

  it('renders a proposal delivered by the source modal creation event', async () => {
    renderSection()

    await waitFor(() => expect(fetchProposals).toHaveBeenCalled())

    act(() => {
      window.dispatchEvent(new CustomEvent('houston:proposal-created', {
        detail: {
          id: 'manual-1', scanRunId: null, userId: 'user-1', system: 'gmail', tier: 2,
          summary: 'Proposal ze zdroje', status: 'PENDING',
          createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z',
        },
      }))
    })

    expect(await screen.findByText('Proposal ze zdroje')).toBeInTheDocument()
  })

  it('returns to the first page when a newly created proposal arrives', async () => {
    vi.mocked(fetchProposals).mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({
      id: `proposal-${index}`,
      scanRunId: null,
      userId: 'user-1',
      system: 'gmail',
      tier: 2,
      summary: `Návrh ${index + 1}`,
      status: 'PENDING' as const,
      createdAt: `2026-09-${String(20 - index).padStart(2, '0')}T09:00:00.000Z`,
      updatedAt: '2026-09-20T09:00:00.000Z',
    })))
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Další' }))
    expect(screen.getByText('Stránka 2 z 2')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent('houston:proposal-created', {
        detail: {
          id: 'manual-1', scanRunId: null, userId: 'user-1', system: 'gmail', tier: 1,
          summary: 'Nově vytvořený návrh', status: 'PENDING',
          createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T09:00:00.000Z',
        },
      }))
    })

    expect(await screen.findByText('Nově vytvořený návrh')).toBeInTheDocument()
    expect(screen.getByText('Stránka 1 z 2')).toBeInTheDocument()
  })
})
