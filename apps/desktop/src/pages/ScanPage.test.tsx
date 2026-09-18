import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import ScanPage from './ScanPage'
import * as scanService from '../services/scanService'

// Mock useScanStream hook
vi.mock('../services/scanService', () => ({
  useScanStream: vi.fn(),
}))

const mockStart = vi.fn()
const mockStop = vi.fn()

function mockHook(overrides: Partial<ReturnType<typeof scanService.useScanStream>['scanState']> = {}) {
  vi.mocked(scanService.useScanStream).mockReturnValue({
    scanState: {
      state: 'idle',
      phase: 'idle',
      message: null,
      logs: [],
      proposals: [],
      autoReadSuggestions: [],
      summary: null,
      errorMessage: null,
      ...overrides,
    },
    start: mockStart,
    stop: mockStop,
    clearAutoReadSuggestions: vi.fn(),
    isRestoring: false,
  })
}

describe('ScanPage', () => {
  beforeEach(() => {
    mockHook()
  })

  it('renders start button in idle state', () => {
    render(<ScanPage />)
    expect(screen.getByRole('button', { name: /start scan/i })).toBeInTheDocument()
  })

  it('calls start when start button is clicked', async () => {
    render(<ScanPage />)
    await userEvent.click(screen.getByRole('button', { name: /start scan/i }))
    expect(mockStart).toHaveBeenCalled()
  })

  it('shows stop button while running', () => {
    mockHook({ state: 'running' })
    render(<ScanPage />)
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
  })

  it('shows error message on error state', () => {
    mockHook({ state: 'error', errorMessage: 'Connection failed' })
    render(<ScanPage />)
    expect(screen.getByText('Connection failed')).toBeInTheDocument()
  })

  it('shows completion summary when completed', () => {
    mockHook({
      state: 'completed',
      summary: { tierCounts: { 1: 1 }, totalItems: 5, proposalCount: 1, sources: { gmail: 5 } },
    })
    render(<ScanPage />)
    expect(screen.getByText(/scan complete/i)).toBeInTheDocument()
  })

  it('renders proposal cards', () => {
    mockHook({
      proposals: [
        {
          id: 'p1',
          system: 'gmail',
          tier: 1,
          summary: 'Reply to client',
          detail: 'Client emailed about the project.',
        },
      ],
    })
    render(<ScanPage />)
    expect(screen.getByText('Reply to client')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
  })
})
