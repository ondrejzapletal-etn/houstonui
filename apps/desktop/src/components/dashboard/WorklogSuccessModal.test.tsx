import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorklogSuccessModal } from './MarkReadSuccessModal'

describe('WorklogSuccessModal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the configured worklog savings and closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <WorklogSuccessModal savedSeconds={12} onClose={onClose} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/Ušetřeno\s*12 sekund\./)
    expect(screen.getByRole('link', { name: 'Nastavení' })).toHaveAttribute('href', '/settings')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes automatically after ten seconds', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <WorklogSuccessModal savedSeconds={10} onClose={onClose} />
      </MemoryRouter>,
    )

    vi.advanceTimersByTime(10_000)
    expect(onClose).toHaveBeenCalledOnce()
  })
})