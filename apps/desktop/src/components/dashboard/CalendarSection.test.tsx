import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CalendarSection from './CalendarSection'

vi.mock('../../hooks/useCalendarEvents', () => ({
  useDashboardCalendarEvents: () => ({
    data: [
      {
        id: 'today-event',
        summary: 'Dnešní schůzka',
        start: '2026-09-09T10:00:00.000Z',
        end: '2026-09-09T11:00:00.000Z',
        allDay: false,
      },
      {
        id: 'tomorrow-event',
        summary: 'Zítřejší schůzka',
        start: '2026-09-10T10:00:00.000Z',
        end: '2026-09-10T11:00:00.000Z',
        allDay: false,
      },
    ],
    isLoading: false,
    error: null,
  }),
}))

describe('CalendarSection', () => {
  it('renders today and tomorrow from the dedicated dashboard calendar query', () => {
    render(<CalendarSection />)

    expect(screen.getByText('Dnešní schůzka')).toBeInTheDocument()
    expect(screen.getByText('Zítřejší schůzka')).toBeInTheDocument()
  })
})