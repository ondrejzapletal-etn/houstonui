import { costUsd } from './pricing'

describe('costUsd', () => {
  it('computes cost for a known Anthropic model', () => {
    // 1M input tokens @ $1 + 1M output tokens @ $5
    expect(costUsd('claude-haiku-4-5', 1_000_000, 1_000_000)).toBeCloseTo(6, 6)
  })

  it('computes cost for a known OpenAI model', () => {
    expect(costUsd('gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6)
  })

  it('scales linearly with token count', () => {
    expect(costUsd('claude-sonnet-5', 500_000, 0)).toBeCloseTo(1, 6)
    expect(costUsd('claude-sonnet-5', 0, 500_000)).toBeCloseTo(5, 6)
  })

  it('handles zero tokens', () => {
    expect(costUsd('claude-haiku-4-5', 0, 0)).toBe(0)
  })

  // Custom ANTHROPIC_MODEL_* / OPENAI_MODEL overrides have no pricing entry.
  it('returns null for an unknown model rather than guessing', () => {
    expect(costUsd('claude-opus-5', 1000, 1000)).toBeNull()
    expect(costUsd('some-future-model', 1000, 1000)).toBeNull()
  })
})
