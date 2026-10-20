import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InfoTooltip from './InfoTooltip'

describe('InfoTooltip', () => {
  it('toggles the section description from its accessible button', () => {
    render(<InfoTooltip label="Výkazy">Popis výkazů.</InfoTooltip>)

    const button = screen.getByRole('button', { name: 'Informace o sekci Výkazy' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('tooltip').textContent).toContain('Popis výkazů.')

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})