import { describe, expect, it } from 'vitest'
import { estimatedProgress } from './ScanRocketProgressBar'

describe('estimatedProgress', () => {
  it('starts at zero and advances quickly at the start of a scan', () => {
    expect(estimatedProgress(0)).toBe(0)
    expect(estimatedProgress(10_000)).toBeGreaterThan(0.35)
  })

  it('slows down and does not reach the end before completion', () => {
    expect(estimatedProgress(70_000)).toBeLessThan(0.88)
    expect(estimatedProgress(300_000)).toBeLessThan(0.9)
  })
})