import type { ConfigService } from '@nestjs/config'
import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider } from './anthropic.provider'
import type { ResolvedChatOptions } from './llm-provider.interface'

interface MockMessage {
  content: Array<Record<string, unknown>>
  usage: { input_tokens: number; output_tokens: number }
  stop_reason: string
}

const reply = (text: string): MockMessage => ({
  content: [{ type: 'text', text }],
  usage: { input_tokens: 10, output_tokens: 5 },
  stop_reason: 'end_turn',
})

/** Shapes a mock return value as what `client.messages.stream(...)` itself returns. */
const okStream = (message: MockMessage) => ({
  finalMessage: () => Promise.resolve(message),
})
const errStream = (err: unknown) => ({ finalMessage: () => Promise.reject(err) })

const configOf = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService

const OPTS: ResolvedChatOptions = {
  quality: 'fast',
  temperature: 0.1,
  jsonMode: false,
}

/**
 * Builds the provider with a stubbed SDK client and returns the `stream` mock.
 * The provider always goes through `client.messages.stream(...).finalMessage()`
 * (see anthropic.provider.ts – non-streaming is refused for our max_tokens), so
 * the mock's return value is a `{ finalMessage }` object, not a resolved Message.
 */
function build(
  env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: 'sk-ant-test' },
  stream: jest.Mock = jest.fn().mockReturnValue(okStream(reply('hello'))),
) {
  const provider = new AnthropicProvider(configOf(env))
  ;(provider as unknown as { client: { messages: { stream: jest.Mock } } }).client = {
    messages: { stream },
  }
  return { provider, create: stream }
}

describe('AnthropicProvider', () => {
  it('refuses to construct without an API key', () => {
    expect(() => new AnthropicProvider(configOf({}))).toThrow(/ANTHROPIC_API_KEY is not set/)
  })

  it('resolves models per quality tier, with env overrides', () => {
    const { provider } = build()
    expect(provider.modelFor('fast')).toBe('claude-haiku-4-5')
    expect(provider.modelFor('high')).toBe('claude-sonnet-5')

    const { provider: custom } = build({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL_FAST: 'custom-fast',
      ANTHROPIC_MODEL_HIGH: 'custom-high',
    })
    expect(custom.modelFor('fast')).toBe('custom-fast')
    expect(custom.modelFor('high')).toBe('custom-high')
  })

  it('lifts system messages into the top-level system param', async () => {
    const { provider, create } = build()

    await provider.chat(
      [
        { role: 'system', content: 'you are a bot' },
        { role: 'user', content: 'hi' },
      ],
      OPTS,
    )

    const req = create.mock.calls[0][0]
    expect(req.system).toBe('you are a bot')
    // Anthropic rejects a 'system' role inside messages.
    expect(req.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('concatenates multiple system messages', async () => {
    const { provider, create } = build()

    await provider.chat(
      [
        { role: 'system', content: 'first' },
        { role: 'system', content: 'second' },
        { role: 'user', content: 'hi' },
      ],
      OPTS,
    )

    expect(create.mock.calls[0][0].system).toBe('first\n\nsecond')
  })

  it('appends the JSON instruction only in jsonMode', async () => {
    const { provider, create } = build()

    await provider.chat([{ role: 'system', content: 'base' }, { role: 'user', content: 'hi' }], {
      ...OPTS,
      jsonMode: true,
    })
    expect(create.mock.calls[0][0].system).toMatch(/no markdown code fences/)

    await provider.chat([{ role: 'system', content: 'base' }, { role: 'user', content: 'hi' }], OPTS)
    expect(create.mock.calls[1][0].system).toBe('base')
  })

  it('always sends max_tokens, defaulting when the caller omits it', async () => {
    const { provider, create } = build()

    await provider.chat([{ role: 'user', content: 'hi' }], OPTS)
    expect(create.mock.calls[0][0].max_tokens).toBe(32000)

    await provider.chat([{ role: 'user', content: 'hi' }], { ...OPTS, maxTokens: 800 })
    expect(create.mock.calls[1][0].max_tokens).toBe(800)
  })

  it('disables thinking so it cannot eat the max_tokens budget', async () => {
    const { provider, create } = build()
    await provider.chat([{ role: 'user', content: 'hi' }], OPTS)
    expect(create.mock.calls[0][0].thinking).toEqual({ type: 'disabled' })
  })

  it('sends temperature to Haiku but not to Sonnet', async () => {
    const { provider, create } = build()

    await provider.chat([{ role: 'user', content: 'hi' }], { ...OPTS, quality: 'fast' })
    expect(create.mock.calls[0][0].temperature).toBe(0.1)

    await provider.chat([{ role: 'user', content: 'hi' }], { ...OPTS, quality: 'high' })
    expect(create.mock.calls[1][0]).not.toHaveProperty('temperature')
  })

  it('joins all text blocks and ignores non-text ones', async () => {
    const create = jest.fn().mockReturnValue(
      okStream({
        content: [
          { type: 'thinking', thinking: 'ignored' },
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      }),
    )
    const { provider } = build({ ANTHROPIC_API_KEY: 'k' }, create)

    expect((await provider.chat([{ role: 'user', content: 'hi' }], OPTS)).text).toBe('ab')
  })

  it('returns the token counts from usage', async () => {
    const { provider } = build()

    const result = await provider.chat([{ role: 'user', content: 'hi' }], OPTS)

    // From the `reply()` fixture: usage: { input_tokens: 10, output_tokens: 5 }.
    expect(result).toMatchObject({ inputTokens: 10, outputTokens: 5 })
  })

  // Non-streaming create() is refused client-side once max_tokens implies >10 min
  // of generation (true for our DEFAULT_MAX_TOKENS regardless of model) – the
  // provider must never fall back to it.
  it('always uses the streaming endpoint, never messages.create', async () => {
    const { provider, create: stream } = build()
    const client = (
      provider as unknown as {
        client: { messages: { stream: jest.Mock; create?: jest.Mock } }
      }
    ).client
    client.messages.create = jest.fn()

    await provider.chat([{ role: 'user', content: 'hi' }], OPTS)

    expect(stream).toHaveBeenCalled()
    expect(client.messages.create).not.toHaveBeenCalled()
  })

  describe('unknown-model temperature self-correction', () => {
    // Body copied from a live 400 – the SDK composes err.message from it, so the
    // fixture has to carry the real shape for the detection to be exercised.
    const temperatureError = () =>
      new Anthropic.BadRequestError(
        400,
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: '`temperature` is deprecated for this model.',
          },
        },
        undefined,
        new Headers(),
      )

    it('retries without temperature after a 400 that names it', async () => {
      const create = jest
        .fn()
        .mockReturnValueOnce(errStream(temperatureError()))
        .mockReturnValueOnce(okStream(reply('ok')))
      const { provider } = build({ ANTHROPIC_API_KEY: 'k' }, create)

      const result = await provider.chat([{ role: 'user', content: 'hi' }], {
        ...OPTS,
        model: 'some-future-model',
      })

      expect(result.text).toBe('ok')
      expect(create).toHaveBeenCalledTimes(2)
      expect(create.mock.calls[0][0]).toHaveProperty('temperature')
      expect(create.mock.calls[1][0]).not.toHaveProperty('temperature')
    })

    it('remembers the quirk so the next call skips temperature outright', async () => {
      const create = jest
        .fn()
        .mockReturnValueOnce(errStream(temperatureError()))
        .mockReturnValue(okStream(reply('ok')))
      const { provider } = build({ ANTHROPIC_API_KEY: 'k' }, create)
      const opts = { ...OPTS, model: 'another-future-model' }

      await provider.chat([{ role: 'user', content: 'hi' }], opts)
      create.mockClear()

      await provider.chat([{ role: 'user', content: 'hi' }], opts)
      expect(create).toHaveBeenCalledTimes(1)
      expect(create.mock.calls[0][0]).not.toHaveProperty('temperature')
    })

    it('rethrows unrelated errors instead of retrying', async () => {
      const create = jest.fn().mockReturnValue(errStream(new Error('network down')))
      const { provider } = build({ ANTHROPIC_API_KEY: 'k' }, create)

      await expect(provider.chat([{ role: 'user', content: 'hi' }], OPTS)).rejects.toThrow(
        'network down',
      )
      expect(create).toHaveBeenCalledTimes(1)
    })

    it('rethrows a 400 that is not about temperature', async () => {
      const create = jest.fn().mockReturnValue(
        errStream(
          new Anthropic.BadRequestError(
            400,
            {
              type: 'error',
              error: { type: 'invalid_request_error', message: 'max_tokens: must be >= 1' },
            },
            undefined,
            new Headers(),
          ),
        ),
      )
      const { provider } = build({ ANTHROPIC_API_KEY: 'k' }, create)

      await expect(provider.chat([{ role: 'user', content: 'hi' }], OPTS)).rejects.toThrow(
        /max_tokens/,
      )
      expect(create).toHaveBeenCalledTimes(1)
    })
  })
})
