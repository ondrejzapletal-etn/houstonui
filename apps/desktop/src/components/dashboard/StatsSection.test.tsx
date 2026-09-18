import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { TimeSavedSummary } from '@houston/shared-types'
import StatsSection from './StatsSection'

const zeroCounts = { scan: 0, processed_message: 0, auto_read: 0, mark_read: 0, worklog: 0 }
const timeSaved: TimeSavedSummary = {
  daily: [
    { period: '2026-08-27', counts: { ...zeroCounts, scan: 2 } },
    { period: '2026-08-28', counts: { ...zeroCounts, scan: 4 } },
    { period: '2026-08-29', counts: { ...zeroCounts, scan: 6 } },
    { period: '2026-08-30', counts: { ...zeroCounts, scan: 8 } },
    { period: '2026-08-31', counts: { ...zeroCounts, scan: 10 } },
    { period: '2026-09-01', counts: { ...zeroCounts, scan: 12 } },
    { period: '2026-09-02', counts: { ...zeroCounts, scan: 14 } },
  ],
  monthly: [
    { period: '2026-06', counts: zeroCounts },
    { period: '2026-07', counts: { ...zeroCounts, scan: 10 } },
    { period: '2026-08', counts: { ...zeroCounts, scan: 20, mark_read: 5 } },
  ],
}

vi.mock('../../hooks/useTimeSaved', () => ({
  useTimeSaved: () => ({ data: timeSaved, isLoading: false, isError: false }),
}))

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (state: { accessToken: null }) => unknown) => selector({ accessToken: null }),
}))

vi.mock('../../store/settingsStore', () => ({
  useSettingsStore: () => ({
    timeSavingsSecondsPerScan: 30,
    timeSavingsSecondsPerMessage: 0,
    timeSavingsSecondsPerAutoRead: 0,
    timeSavingsSecondsPerMarkRead: 60,
    timeSavingsSecondsPerWorklog: 0,
  }),
}))

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <StatsSection />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('StatsSection', () => {
  it('does not show token usage', () => {
    renderSection()

    expect(screen.queryByText('Spotřeba tokenů v tomto měsíci')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Spotřeba v dolarech za poslední 3 měsíce')).not.toBeInTheDocument()
  })

  it('shows time savings for the last seven days by day', () => {
    renderSection()

    // Seven daily buckets have 1 through 7 minutes, totalling 28 minutes.
    expect(screen.getByText('Úspora času za posledních 7 dní')).toBeInTheDocument()
    expect(screen.getByText('28m')).toBeInTheDocument()
    expect(screen.getByLabelText('Úspora času za posledních 7 dní v minutách')).toBeInTheDocument()
    for (const minutes of [1, 2, 3, 4, 5, 6, 7]) {
      expect(screen.getByText(`${minutes} min`)).toBeInTheDocument()
    }
    expect(screen.getByTitle('01. 9.: 6m')).toHaveStyle({ height: '85.71428571428571%' })
    expect(screen.getByTitle('02. 9.: 7m')).toHaveStyle({ height: '100%' })
    expect(screen.queryByText('15 min')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Zobrazit reporty' })).toHaveAttribute('href', '/reports')
  })
})