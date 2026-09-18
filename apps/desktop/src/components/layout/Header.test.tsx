import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import Header from './Header'

function LocationDisplay() {
  const location = useLocation()
  return <output>{location.pathname}</output>
}

describe('Header', () => {
  afterEach(() => {
    localStorage.removeItem('houston_onboarding_complete')
    useAuthStore.setState({ accessToken: null, isAuthenticated: false, user: null, expiresAt: null })
    useSettingsStore.setState({
      timeSavingsSecondsPerScan: 30,
      timeSavingsSecondsPerMessage: 30,
      timeSavingsSecondsPerAutoRead: 5,
      timeSavingsSecondsPerMarkRead: 5,
      timeSavingsSecondsPerWorklog: 10,
    })
    vi.unstubAllGlobals()
  })

  it('navigates to the dashboard when the brand is clicked', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter initialEntries={['/context']}>
        <QueryClientProvider client={queryClient}>
          <Header />
          <LocationDisplay />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('link', { name: 'Houston - Dashboard' }))

    expect(screen.getByRole('status')).toHaveTextContent('/')
  })

  it('includes manual mark-read savings and exposes the user menu', async () => {
    localStorage.setItem('houston_onboarding_complete', 'true')
    useAuthStore.setState({
      accessToken: 'test-token',
      isAuthenticated: true,
      user: { id: 'user-1', email: 'user@example.com', displayName: 'User' },
      expiresAt: Date.now() + 3_600_000,
    })
    useSettingsStore.setState({
      timeSavingsSecondsPerScan: 0,
      timeSavingsSecondsPerMessage: 0,
      timeSavingsSecondsPerAutoRead: 0,
      timeSavingsSecondsPerMarkRead: 468_015,
      timeSavingsSecondsPerWorklog: 0,
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          scansCount: 0,
          processedMessagesCount: 0,
          autoReadCount: 0,
          markReadCount: 1,
          worklogsCount: 0,
          worklogsSeconds: 0,
          proposalsCount: 0,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { count: 0, seconds: 0 } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Header />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTitle('Celková úspora času')).toHaveTextContent('5d 10h 15s'))
    const savings = screen.getByTitle('Celková úspora času')
    const userMenu = screen.getByRole('button', { name: 'user@example.com' })
    expect(savings.compareDocumentPosition(userMenu) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    await userEvent.setup().click(userMenu)
    expect(screen.getByRole('menuitem', { name: 'Nastavení' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Reporty' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Odhlásit se' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/users/me/stats'), expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/jira/worklogs/stats'), expect.any(Object))
  })
})