import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarIssueLinkDto } from '@houston/shared-types'
import AddWorklogModal from './AddWorklogModal'
import { useSettingsStore } from '../../store/settingsStore'
import { useAuthStore } from '../../store/authStore'

const mocks = vi.hoisted(() => ({
  link: {
    data: null as CalendarIssueLinkDto | null | undefined,
    isSuccess: true,
    isError: false,
  },
  save: vi.fn(),
  add: vi.fn<(body: unknown, options?: { onSuccess?: () => void }) => void>(),
  project: vi.fn(),
  summary: vi.fn(),
}))

vi.mock('../../hooks/useCalendarLink', () => ({
  useCalendarLink: () => mocks.link,
  useSaveCalendarLink: () => ({ mutate: mocks.save }),
}))
vi.mock('../../hooks/useAddWorklog', () => ({
  useAddWorklog: () => ({ mutate: mocks.add, reset: vi.fn(), isPending: false, isError: false, isSuccess: false }),
}))
vi.mock('../../hooks/useAddClockifyWorklog', () => ({
  useAddClockifyWorklog: () => ({ mutate: vi.fn(), reset: vi.fn() }),
}))
vi.mock('../../hooks/useUpdateWorklog', () => ({
  useUpdateWorklog: () => ({ mutate: vi.fn(), reset: vi.fn() }),
}))
vi.mock('../../hooks/useJiraWorklogs', () => ({ useJiraWorklogs: () => ({ secondsPerDay: {} }) }))
vi.mock('../../hooks/useClockifyWorklogs', () => ({ useClockifyWorklogs: () => ({ secondsPerDay: {} }) }))
vi.mock('../../hooks/useKnowledge', () => ({ useKnowledgeTasks: () => ({ data: [] }) }))
vi.mock('../../hooks/useMonthlyWorklogIssues', () => ({ useMonthlyWorklogIssues: () => ({ issues: [] }) }))
vi.mock('../../hooks/useIssueSuggestion', () => ({ useIssueSuggestion: () => ({ data: null }) }))
vi.mock('../../hooks/useIssueSearch', () => ({
  useIssueSearch: () => ({ data: [{ issueKey: 'PROJ-42', summary: 'Selected issue' }] }),
}))
vi.mock('../../services/calendarClient', () => ({ fetchCalendarEvent: vi.fn().mockResolvedValue(null) }))
vi.mock('../../services/projectsClient', () => ({ fetchIssueSummary: mocks.summary, createClient: vi.fn() }))
vi.mock('../../services/connectorsClient', () => ({ findOrCreateProjectByJiraKey: mocks.project }))
vi.mock('./MarkReadSuccessModal', () => ({ WorklogSuccessModal: () => null }))

const savedLink: CalendarIssueLinkDto = {
  id: 'link-1',
  calendarEventId: 'previous-occurrence',
  issueKey: 'PROJ-123',
  createdAt: '2026-10-08T09:00:00Z',
  updatedAt: '2026-10-08T09:00:00Z',
}

function openModal(props: Partial<React.ComponentProps<typeof AddWorklogModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <AddWorklogModal calendarEventId="current-event" defaultDurationSeconds={3600} onClose={vi.fn()} {...props} />,
    { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
  )
}

function bindingRow() {
  return screen.getByRole('group', { name: 'Vazba kalendářové události' })
}

function mainInput() {
  return screen.getByRole('textbox', { name: '' })
}

describe('calendar binding header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.link = { data: null, isSuccess: true, isError: false }
    mocks.project.mockResolvedValue({ success: true, wasCreated: false })
    useSettingsStore.setState({ recentJiraIssues: [] })
    useAuthStore.setState({ accessToken: 'token' })
    mocks.summary.mockResolvedValue(null)
  })

  afterEach(cleanup)

  it('does not render the row without an event ID', () => {
    openModal({ calendarEventId: undefined })
    expect(screen.queryByRole('group', { name: 'Vazba kalendářové události' })).not.toBeInTheDocument()
  })

  it('loads and persists the tooltip name for a recent issue without a summary or calendar context', async () => {
    useSettingsStore.setState({ recentJiraIssues: [{ key: 'CEZNFK-1', summary: 'Operativa' }, { key: 'TIME-2' }] })
    mocks.summary.mockResolvedValue('Reporting')
    openModal({ calendarEventId: undefined })
    const recent = screen.getByLabelText('Nedávné issues')
    const chip = within(recent).getByRole('button', { name: 'TIME-2' })
    fireEvent.mouseEnter(chip)
    await waitFor(() => expect(within(chip).getByRole('tooltip')).toHaveTextContent('Reporting'))
    expect(mocks.summary).toHaveBeenCalledTimes(1)
    expect(mocks.summary).toHaveBeenCalledWith('token', 'TIME-2')
    expect(useSettingsStore.getState().recentJiraIssues).toEqual([
      { key: 'CEZNFK-1', summary: 'Operativa' }, { key: 'TIME-2', summary: 'Reporting' },
    ])
    fireEvent.click(chip)
    fireEvent.click(screen.getByRole('button', { name: 'Uložit' }))
    await waitFor(() => expect(mocks.add).toHaveBeenCalled())
    act(() => mocks.add.mock.calls[0][1]?.onSuccess?.())
    expect(useSettingsStore.getState().recentJiraIssues[0]).toEqual({ key: 'TIME-2', summary: 'Reporting' })
  })

  it('keeps the form usable when the recent issue name cannot be loaded', async () => {
    useSettingsStore.setState({ recentJiraIssues: [{ key: 'TIME-2' }] })
    mocks.summary.mockRejectedValue(new Error('Unavailable'))
    openModal({ calendarEventId: undefined })
    await waitFor(() => expect(mocks.summary).toHaveBeenCalled())
    fireEvent.click(within(screen.getByLabelText('Nedávné issues')).getByRole('button', { name: 'TIME-2' }))
    expect(mainInput()).toHaveValue('TIME-2')
  })

  it('shows the current event and saved issue, including a series binding', () => {
    mocks.link.data = savedLink
    openModal({ recurringEventId: 'series-1' })
    expect(within(bindingRow()).getByText('current-even')).toHaveAttribute('title', 'current-event')
    expect(within(bindingRow()).getByText('PROJ-123')).toBeInTheDocument()
    const chip = within(bindingRow()).getByLabelText('Událost: current-event; Jira: PROJ-123')
    expect(chip).toHaveClass('inline-flex', 'whitespace-nowrap', 'border-blue-700', 'text-blue-300')
    expect(screen.queryByText('previous-occurrence')).not.toBeInTheDocument()
    expect(mainInput()).toHaveValue('PROJ-123')
    expect(within(bindingRow()).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders an empty small input when no binding exists', () => {
    openModal()
    expect(within(bindingRow()).getByText('current-even')).toBeInTheDocument()
    expect(within(bindingRow()).queryByText('current-event')).not.toBeInTheDocument()
    expect(within(bindingRow()).getByRole('textbox').closest('label')?.parentElement).toHaveClass('flex', 'items-center')
    expect(within(bindingRow()).getByRole('textbox').closest('label')?.parentElement).not.toHaveClass('flex-col')
    expect(within(bindingRow()).getByRole('textbox')).toHaveValue('')
    expect(mainInput()).toHaveFocus()
  })

  it('shows only the first 12 event ID characters in a saved binding chip', () => {
    mocks.link.data = savedLink
    const eventId = 'calendar-event-with-a-long-identifier'
    openModal({ calendarEventId: eventId })
    expect(within(bindingRow()).getByText('calendar-eve')).toHaveAttribute('title', eventId)
    expect(within(bindingRow()).queryByText(eventId)).not.toBeInTheDocument()
  })

  it('keeps short event IDs unchanged in a saved binding chip', () => {
    mocks.link.data = savedLink
    openModal({ calendarEventId: 'event-1' })
    expect(within(bindingRow()).getByText('event-1')).toBeInTheDocument()
  })

  it('synchronizes manual edits in both directions without saving', () => {
    openModal()
    const headerInput = within(bindingRow()).getByRole('textbox')
    fireEvent.change(headerInput, { target: { value: 'PROJ-7' } })
    expect(mainInput()).toHaveValue('PROJ-7')
    fireEvent.change(mainInput(), { target: { value: 'PROJ-8' } })
    expect(headerInput).toHaveValue('PROJ-8')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('synchronizes an autocomplete selection', () => {
    openModal()
    fireEvent.mouseDown(screen.getByRole('option'))
    expect(within(bindingRow()).getByRole('textbox')).toHaveValue('PROJ-42')
  })

  it('preserves a known default issue in both fields', () => {
    openModal({ defaultIssueKey: 'PROJ-9' })
    expect(within(bindingRow()).getByRole('textbox')).toHaveValue('PROJ-9')
    expect(mainInput()).toHaveValue('PROJ-9')
  })

  it('shows loading rather than an empty input, then prefills the loaded binding', () => {
    mocks.link = { data: undefined, isSuccess: false, isError: false }
    const view = openModal()
    expect(within(bindingRow()).getByRole('status')).toHaveTextContent('Načítám vazbu')
    expect(within(bindingRow()).queryByRole('textbox')).not.toBeInTheDocument()
    mocks.link = { data: savedLink, isSuccess: true, isError: false }
    view.rerender(<AddWorklogModal calendarEventId="current-event" onClose={vi.fn()} />)
    expect(mainInput()).toHaveValue('PROJ-123')
  })

  it('does not overwrite a draft when the saved binding arrives later', () => {
    mocks.link = { data: undefined, isSuccess: false, isError: false }
    const view = openModal()
    fireEvent.change(mainInput(), { target: { value: 'PROJ-8' } })
    mocks.link = { data: savedLink, isSuccess: true, isError: false }
    view.rerender(<AddWorklogModal calendarEventId="current-event" onClose={vi.fn()} />)
    expect(mainInput()).toHaveValue('PROJ-8')
    expect(within(bindingRow()).getByText('PROJ-123')).toBeInTheDocument()
  })

  it('does not present a load error as a missing binding', () => {
    mocks.link = { data: undefined, isSuccess: false, isError: true }
    openModal()
    expect(within(bindingRow()).getByRole('status')).toHaveTextContent('Vazbu se nepodařilo načíst.')
    expect(within(bindingRow()).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('retains a cached binding after a refetch error and when the draft changes', () => {
    mocks.link = { data: savedLink, isSuccess: false, isError: true }
    openModal()
    fireEvent.change(mainInput(), { target: { value: 'PROJ-8' } })
    expect(within(bindingRow()).getByText('PROJ-123')).toBeInTheDocument()
    expect(within(bindingRow()).queryByRole('status')).not.toBeInTheDocument()
  })

  it('saves the issue entered in the header only after successful Jira submission', async () => {
    openModal()
    fireEvent.change(within(bindingRow()).getByRole('textbox'), { target: { value: 'proj-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Uložit' }))
    await waitFor(() => expect(mocks.add).toHaveBeenCalled())
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.add.mock.calls[0][0]).toMatchObject({ issueKey: 'PROJ-7' })
    act(() => mocks.add.mock.calls[0][1]?.onSuccess?.())
    expect(mocks.save).toHaveBeenCalledWith({ issueKey: 'PROJ-7' })
  })

  it('does not save a binding when project verification fails', async () => {
    mocks.project.mockResolvedValue({ success: false, error: 'Rejected' })
    openModal()
    fireEvent.change(within(bindingRow()).getByRole('textbox'), { target: { value: 'PROJ-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Uložit' }))
    await screen.findByRole('alert')
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})