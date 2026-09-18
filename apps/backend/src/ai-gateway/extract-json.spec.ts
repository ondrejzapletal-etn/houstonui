import { extractJson } from './extract-json'

describe('extractJson', () => {
  it('leaves bare JSON untouched', () => {
    expect(extractJson('{"ok":true}')).toBe('{"ok":true}')
    expect(extractJson('[1,2,3]')).toBe('[1,2,3]')
  })

  it('escapes raw line breaks inside JSON string values', () => {
    const json = extractJson('{"summary":"## Aktualizace\n- První bod\n- Druhý bod","proposals":[]}')

    expect(JSON.parse(json)).toEqual({
      summary: '## Aktualizace\n- První bod\n- Druhý bod',
      proposals: [],
    })
  })

  it('is idempotent', () => {
    const once = extractJson('```json\n{"ok":true}\n```')
    expect(extractJson(once)).toBe(once)
  })

  // The exact shape Haiku 4.5 returned during the live provider probe.
  it('strips a ```json fence', () => {
    expect(extractJson('```json\n{"ok":true,"n":3}\n```')).toBe('{"ok":true,"n":3}')
  })

  it('strips an unlabelled fence', () => {
    expect(extractJson('```\n[{"a":1}]\n```')).toBe('[{"a":1}]')
  })

  it('drops prose before and after the payload', () => {
    expect(extractJson('Here you go:\n{"a":1}\nHope that helps!')).toBe('{"a":1}')
  })

  it('keeps nested braces intact', () => {
    const nested = '{"a":{"b":[1,2]},"c":"}"}'
    expect(extractJson(`prefix ${nested}`)).toBe(nested)
  })

  it('handles a top-level array wrapped in prose', () => {
    expect(extractJson('Result: [{"tier":1}] done')).toBe('[{"tier":1}]')
  })

  it('trims surrounding whitespace', () => {
    expect(extractJson('  \n {"a":1} \n ')).toBe('{"a":1}')
  })

  it('returns the input unchanged when there is no JSON to find', () => {
    expect(extractJson('I cannot help with that.')).toBe('I cannot help with that.')
  })

  it('returns the input unchanged when the payload never closes', () => {
    expect(extractJson('{"a":1')).toBe('{"a":1')
  })
})
