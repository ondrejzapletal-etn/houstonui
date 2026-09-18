import { describe, it, expect } from 'vitest'
import { parseTimeInput, formatSeconds } from './AddWorklogModal'

describe('parseTimeInput', () => {
  it('parses "1h 30m"', () => expect(parseTimeInput('1h 30m')).toBe(5400))
  it('parses "90m"', () => expect(parseTimeInput('90m')).toBe(5400))
  it('parses "1.5h"', () => expect(parseTimeInput('1.5h')).toBe(5400))
  it('parses "2h"', () => expect(parseTimeInput('2h')).toBe(7200))
  it('parses "3600" as seconds', () => expect(parseTimeInput('3600')).toBe(3600))
  it('parses "30m"', () => expect(parseTimeInput('30m')).toBe(1800))
  it('returns null for empty string', () => expect(parseTimeInput('')).toBeNull())
  it('returns null for "0"', () => expect(parseTimeInput('0')).toBeNull())
  it('returns null for < 60 seconds ("30")', () => expect(parseTimeInput('30')).toBeNull())
  it('returns null for garbage input', () => expect(parseTimeInput('abc')).toBeNull())
  it('is case-insensitive', () => expect(parseTimeInput('1H 30M')).toBe(5400))
  it('trims whitespace', () => expect(parseTimeInput('  2h  ')).toBe(7200))
})

describe('formatSeconds', () => {
  it('formats 3600 as "1h"', () => expect(formatSeconds(3600)).toBe('1h'))
  it('formats 5400 as "1h 30m"', () => expect(formatSeconds(5400)).toBe('1h 30m'))
  it('formats 1800 as "30m"', () => expect(formatSeconds(1800)).toBe('30m'))
})
