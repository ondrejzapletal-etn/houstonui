import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ScanProposalData } from '@houston/shared-types'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../store/settingsStore'
import { ProposalCard } from './ProposalCard'

function renderProposal(proposal: ScanProposalData, isExpanded: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ProposalCard proposal={proposal} isExpanded={isExpanded} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })
}

describe('ProposalCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a persisted Gmail received time in the collapsed header', () => {
    const sourceOccurredAt = '2026-08-31T14:30:00.000Z'
    renderProposal({
      id: 'proposal-1',
      system: 'gmail',
      tier: 1,
      summary: 'Reply to client',
      sourceOccurredAt,
    }, false)

    expect(screen.getByText(`Přijato: ${formatDate(sourceOccurredAt)}`)).toBeInTheDocument()
  })

  it('uses the original Slack message timestamp when older proposals lack the persisted field', () => {
    const sourceOccurredAt = '2026-08-31T14:30:00.000Z'
    renderProposal({
      id: 'proposal-2',
      system: 'slack',
      tier: 1,
      summary: 'Reply in channel',
      originalMessage: `Channel: #team\nDate: ${sourceOccurredAt}\n---\nPlease reply`,
    }, true)

    expect(screen.getByText(`Odesláno: ${formatDate(sourceOccurredAt)}`)).toBeInTheDocument()
  })

  it('uses a native Slack timestamp when older proposals lack a Date header', () => {
    const slackTimestamp = '1788186600.000000'
    const sourceOccurredAt = new Date(Number(slackTimestamp) * 1000).toISOString()
    renderProposal({
      id: 'proposal-legacy-slack',
      system: 'slack',
      tier: 1,
      summary: 'Reply in channel',
      originalMessage: `Channel: #team\nTimestamp: ${slackTimestamp}\n---\nPlease reply`,
    }, true)

    expect(screen.getByText(`Odesláno: ${formatDate(sourceOccurredAt)}`)).toBeInTheDocument()
  })

  it('renders a proposal with a persisted READ status as resolved', () => {
    renderProposal({
      id: 'proposal-3',
      system: 'gmail',
      tier: 1,
      summary: 'Reply to client',
      status: 'READ',
    }, true)

    expect(screen.getByText('Návrh byl vyřešen (zpráva označena jako přečtená)')).toBeInTheDocument()
  })

  it.each(['gmail', 'slack'] as const)('shows the %s icon in the reply confirmation button', (system) => {
    renderProposal({
      id: `proposal-${system}`,
      system,
      tier: 1,
      summary: 'Reply to client',
      draft: 'Thank you for your message.',
      originalMessage: system === 'gmail' ? 'From: user@example.com' : 'Channel: #team',
    }, true)

    fireEvent.click(screen.getByRole('button', { name: 'Odpovědět' }))

    const confirmButton = screen.getByRole('button', { name: 'Potvrdit a odeslat' })
    expect(confirmButton.querySelector('img')).toHaveAttribute('src', expect.stringContaining(`${system}.webp`))
  })

  it('explains and confirms a successful manual mark-read action', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { source: 'gmail' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    useSettingsStore.setState({ timeSavingsSecondsPerMarkRead: 5 })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ProposalCard
            isExpanded
            proposal={{ id: 'proposal-4', system: 'gmail', tier: 1, summary: 'Reply', originalMessage: 'From: user@example.com' }}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    const button = screen.getByRole('button', { name: 'Označit přečtené' })
    expect(button).toHaveAttribute(
      'title',
      'Po kliknutí na tlačítko bude původní zpráva označena jako přečtená, proposal se označí jako vyřešený',
    )
    fireEvent.click(button)

    expect(await screen.findByRole('dialog')).toHaveTextContent('Co se stalo?')
    expect(screen.getByRole('dialog')).toHaveTextContent('Gmailu')
    expect(screen.getByRole('dialog')).toHaveTextContent('5 sekund.')
    expect(screen.getByRole('link', { name: 'Nastavení' })).toHaveAttribute('href', '/settings')
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['user-stats'] }))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders document reviews without Gmail reply controls and resolves explicitly', async () => {
    const sourceOccurredAt = '2026-08-31T14:30:00.000Z'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { source: 'gmail' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    renderProposal({
      id: 'docs-proposal',
      system: 'gmail',
      kind: 'DOCUMENT_REVIEW',
      tier: 1,
      summary: 'Reagovat na komentáře v dokumentu Houston',
      detail: '1. Prosím zkontroluj vysvětlení obrázku.',
      url: 'https://docs.google.com/document/d/document-1',
      sourceMessageIds: ['docs-1', 'docs-2'],
      sourceOccurredAt,
    }, true)

    expect(screen.getByText(`Přijato: ${formatDate(sourceOccurredAt)}`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Odpovědět' })).not.toBeInTheDocument()
    expect(screen.queryByText('Návrh odpovědi:')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Otevřít dokument ↗' })).toHaveAttribute(
      'href',
      'https://docs.google.com/document/d/document-1',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Vyřešeno' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/proposals/docs-proposal/resolve-document-review'),
      expect.objectContaining({ method: 'POST' }),
    ))
    expect(await screen.findByText('Komentáře v dokumentu byly označeny jako vyřešené.')).toBeInTheDocument()
  })
})