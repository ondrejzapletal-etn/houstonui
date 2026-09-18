import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import WorklogsSection from './WorklogsSection'

vi.mock('../../hooks/useJiraWorklogs', () => ({
  useJiraWorklogs: () => ({
    secondsPerDay: { 3: 3600 },
    year: 2026,
    month: 5,
    isLoading: false,
    isError: false,
    isJiraConnected: true,
    prevMonth: vi.fn(),
    nextMonth: vi.fn(),
  }),
}))

vi.mock('../../hooks/useClockifyWorklogs', () => ({
  useClockifyWorklogs: () => ({
    secondsPerDay: {},
    isLoading: false,
    isClockifyConnected: true,
  }),
}))

vi.mock('../../hooks/useMonthlyWorklogIssues', () => ({
  useMonthlyWorklogIssues: () => ({
    issues: [
      {
        source: 'jira',
        reference: 'ROSS-124',
        title: 'Feature A',
        totalSeconds: 3600,
        jiraIssueKey: 'ROSS-124',
      },
      {
        source: 'jira',
        reference: 'ROSS-125',
        title: 'Feature B',
        totalSeconds: 1800,
        jiraIssueKey: 'ROSS-125',
      },
      {
        source: 'jira',
        reference: 'PROJ-55',
        title: 'Fix auth redirect',
        totalSeconds: 5400,
        jiraIssueKey: 'PROJ-55',
      },
      {
        source: 'jira',
        reference: 'abc123',
        title: 'Legacy key',
        totalSeconds: 900,
      },
      {
        source: 'clockify',
        reference: 'Internal',
        title: 'No jira key A',
        totalSeconds: 1800,
      },
      {
        source: 'clockify',
        reference: 'Internal',
        title: 'No jira key B',
        totalSeconds: 1200,
      },
    ],
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('../../hooks/useWorklogsByIssue', () => ({
  useWorklogsByIssue: ({ source, reference }: { source: 'jira' | 'clockify'; reference: string }) => {
    if (source === 'jira' && reference === 'ROSS-124') {
      return {
        worklogs: [
          {
            source: 'jira',
            id: 'wl-1',
            issueId: 'ROSS-124',
            issueName: 'Feature A',
            started: '2026-05-03T09:00:00.000+0000',
            timeSpentSeconds: 1800,
            comment: 'Review',
          },
        ],
        isLoading: false,
        isError: false,
      }
    }

    if (source === 'clockify' && reference === 'Internal') {
      return {
        worklogs: [
          {
            source: 'clockify',
            id: 'clk-1',
            started: '2026-05-04T09:00:00Z',
            timeSpentSeconds: 1200,
            description: 'Standup',
            project: 'Internal',
          },
        ],
        isLoading: false,
        isError: false,
      }
    }

    return { worklogs: [], isLoading: false, isError: false }
  },
}))

vi.mock('../../hooks/useConnectors', () => ({
  useConnectors: () => ({
    connect: vi.fn(),
    connectingType: null,
  }),
}))

vi.mock('../../hooks/useCalendarEvents', () => ({
  default: () => ({ data: [], isLoading: false }),
}))

vi.mock('../../hooks/useDailyActivity', () => ({
  default: () => ({ data: { sentEmails: [], sentSlackMessages: [] }, isLoading: false }),
}))

vi.mock('../../store/settingsStore', () => ({
  useSettingsStore: (selector: (s: { workingDayHours: number }) => number) => selector({ workingDayHours: 8 }),
}))

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (s: { accessToken: string }) => string) => selector({ accessToken: 'token' }),
}))

vi.mock('../../services/connectorsClient', () => ({
  fetchJiraWorklogsDay: vi.fn(),
  fetchClockifyWorklogsDay: vi.fn(),
}))

vi.mock('../../services/calendarClient', () => ({
  fetchCalendarRange: vi.fn(),
}))

vi.mock('./KnowledgeTasksSection', () => ({
  default: () => React.createElement('div', { 'data-testid': 'knowledge-section' }),
}))

vi.mock('./WorklogDetailsModal', () => ({
  default: () => React.createElement('div', { 'data-testid': 'worklog-details-modal' }),
}))

vi.mock('./AddWorklogModal', () => ({
  default: (props: {
    defaultIssueKey?: string
    defaultDate?: string
    defaultDurationSeconds?: number
    editWorklogId?: string
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'add-worklog-modal' },
      [
        `issue:${props.defaultIssueKey ?? ''}`,
        `date:${props.defaultDate ?? ''}`,
        `duration:${props.defaultDurationSeconds ?? ''}`,
        `edit:${props.editWorklogId ?? ''}`,
      ].join('|'),
    ),
}))

function renderInProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(WorklogsSection),
    ),
  )
}

describe('WorklogsSection monthly issues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  it('zobrazí monthly issues po kliknutí na ukázat issues', async () => {
    renderInProviders()

    fireEvent.click(screen.getByRole('button', { name: 'Issues v tomto měsíci' }))

    await waitFor(() => {
      expect(screen.getByText('Issue/Projekt')).toBeInTheDocument()
    })
    expect(screen.getByText('PROJ-55')).toBeInTheDocument()
    expect(screen.getAllByText('Internal').length).toBeGreaterThan(0)
  })

  it('disable tlačítko Vykaž bez jiraIssueKey a předvyplní issue pro validní řádek', async () => {
    renderInProviders()

    fireEvent.click(screen.getByRole('button', { name: 'Issues v tomto měsíci' }))

    await waitFor(() => {
      expect(screen.getByText('PROJ-55')).toBeInTheDocument()
    })

    const disabledButton = screen.getAllByTitle('chybí Jira issue key')[0]
    expect(disabledButton).toBeDisabled()

    fireEvent.click(screen.getAllByTitle('Vykaž')[0])

    await waitFor(() => {
      expect(screen.getByTestId('add-worklog-modal')).toBeInTheDocument()
    })
    expect(screen.getByTestId('add-worklog-modal')).toHaveTextContent('issue:ROSS-124')
  })

  it('zobrazí agregované projekty po kliknutí na projekty v tomto měsíci', async () => {
    renderInProviders()

    fireEvent.click(screen.getByRole('button', { name: 'Projekty v tomto měsíci' }))

    await waitFor(() => {
      expect(screen.getByText('Počet položek')).toBeInTheDocument()
    })

    expect(screen.getByText('ROSS')).toBeInTheDocument()
    expect(screen.getByText('PROJ')).toBeInTheDocument()
    expect(screen.getByText('abc123')).toBeInTheDocument()

    expect(screen.getAllByText('Internal').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1:30').length).toBeGreaterThan(0)
    expect(screen.getByText('0:15')).toBeInTheDocument()
    expect(screen.getByText('0:50')).toBeInTheDocument()
    expect(screen.queryByTitle('Vykaž')).not.toBeInTheDocument()
  })

  it('po kliknutí na projekt zobrazí jeho issue řádky', async () => {
    renderInProviders()

    fireEvent.click(screen.getByRole('button', { name: 'Projekty v tomto měsíci' }))

    await waitFor(() => {
      expect(screen.getByText('ROSS')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('ROSS').closest('tr')!)

    await waitFor(() => {
      expect(screen.getByText('ROSS-124')).toBeInTheDocument()
      expect(screen.getByText('ROSS-125')).toBeInTheDocument()
    })
    expect(screen.getAllByTitle('Vykaž')).toHaveLength(2)
  })

  it('předvyplní původní datum a délku při editaci worklogu z projektu', async () => {
    renderInProviders()

    fireEvent.click(screen.getByRole('button', { name: 'Projekty v tomto měsíci' }))
    await waitFor(() => expect(screen.getByText('ROSS')).toBeInTheDocument())

    fireEvent.click(screen.getByText('ROSS').closest('tr')!)
    await waitFor(() => expect(screen.getByText('Feature A')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Feature A').closest('tr')!)
    await waitFor(() => expect(screen.getByText('Review')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Upravit výkaz'))

    await waitFor(() => {
      expect(screen.getByTestId('add-worklog-modal')).toHaveTextContent(
        'date:2026-05-03|duration:1800|edit:wl-1',
      )
    })
  })

  it('umožní mít otevřenou vždy jen jednu sekci issues/projekty/úkoly', async () => {
    renderInProviders()

    fireEvent.click(screen.getByRole('button', { name: 'Issues v tomto měsíci' }))
    await waitFor(() => {
      expect(screen.getByText('Issue/Projekt')).toBeInTheDocument()
    })
    expect(screen.queryByText('Počet položek')).not.toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-section')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Projekty v tomto měsíci' }))
    await waitFor(() => {
      expect(screen.getByText('Počet položek')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByText('Issue/Projekt')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('knowledge-section')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Úkoly v tomto měsíci' }))
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-section')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByText('Issue/Projekt')).not.toBeInTheDocument()
      expect(screen.queryByText('Počet položek')).not.toBeInTheDocument()
    })
  })

  it('po kliknutí na issue řádek rozbalí detailní worklogy', async () => {
    renderInProviders()

    fireEvent.click(screen.getByRole('button', { name: 'Issues v tomto měsíci' }))

    await waitFor(() => {
      expect(screen.getByText('ROSS-124')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('ROSS-124'))

    await waitFor(() => {
      expect(screen.getByText('Review')).toBeInTheDocument()
    })
    expect(screen.getByTitle('Upravit výkaz')).toBeInTheDocument()
  })

  it('Clockify detailní worklog nemá tlačítko editace', async () => {
    renderInProviders()

    fireEvent.click(screen.getByRole('button', { name: 'Issues v tomto měsíci' }))

    await waitFor(() => {
      expect(screen.getAllByText('Internal').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getAllByText('Internal')[0])

    await waitFor(() => {
      expect(screen.getByText('Standup')).toBeInTheDocument()
    })
    expect(screen.queryByTitle('Upravit výkaz')).not.toBeInTheDocument()
  })
})
