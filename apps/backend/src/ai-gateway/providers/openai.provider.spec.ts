import type { ConfigService } from '@nestjs/config'
import { OpenAiProvider } from './openai.provider'
import type { ResolvedChatOptions } from './llm-provider.interface'

const reply = (content: string, promptTokens = 10, completionTokens = 5) => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
})

const configOf = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService

const OPTS: ResolvedChatOptions = {
  quality: 'fast',
  temperature: 0.2,
  jsonMode: false,
}

function build(
  env: Record<string, string | undefined> = { OPENAI_API_KEY: 'sk-test' },
  create: jest.Mock = jest.fn().mockResolvedValue(reply('hi')),
) {
  const provider = new OpenAiProvider(configOf(env))
  ;(provider as unknown as { client: { chat: { completions: { create: jest.Mock } } } }).client = {
    chat: { completions: { create } },
  }
  return { provider, create }
}

describe('OpenAiProvider', () => {
  it('refuses to construct without an API key', () => {
    expect(() => new OpenAiProvider(configOf({}))).toThrow(/OPENAI_API_KEY is not set/)
  })

  it('resolves models per quality tier, with env overrides', () => {
    const { provider } = build()
    expect(provider.modelFor('fast')).toBe('gpt-4o-mini')
    expect(provider.modelFor('high')).toBe('gpt-4o')

    const { provider: custom } = build({
      OPENAI_API_KEY: 'k',
      OPENAI_MODEL: 'custom-fast',
      OPENAI_MODEL_HIGH: 'custom-high',
    })
    expect(custom.modelFor('fast')).toBe('custom-fast')
    expect(custom.modelFor('high')).toBe('custom-high')
  })

  it('returns the reply text and token counts from usage', async () => {
    const { provider, create } = build(undefined, jest.fn().mockResolvedValue(reply('hello', 20, 8)))

    const result = await provider.chat([{ role: 'user', content: 'hi' }], OPTS)

    expect(result).toEqual({ text: 'hello', inputTokens: 20, outputTokens: 8 })
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o-mini', temperature: 0.2 })
  })

  it('defaults token counts to 0 when usage is missing from the response', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'hi' } }] })
    const { provider } = build(undefined, create)

    expect(await provider.chat([{ role: 'user', content: 'hi' }], OPTS)).toEqual({
      text: 'hi',
      inputTokens: 0,
      outputTokens: 0,
    })
  })

  it('sets response_format only in jsonMode', async () => {
    const { provider, create } = build()

    await provider.chat([{ role: 'user', content: 'hi' }], { ...OPTS, jsonMode: true })
    expect(create.mock.calls[0][0].response_format).toEqual({ type: 'json_object' })

    await provider.chat([{ role: 'user', content: 'hi' }], OPTS)
    expect(create.mock.calls[1][0]).not.toHaveProperty('response_format')
  })

  it('sends max_tokens only when the caller passes one', async () => {
    const { provider, create } = build()

    await provider.chat([{ role: 'user', content: 'hi' }], OPTS)
    expect(create.mock.calls[0][0]).not.toHaveProperty('max_tokens')

    await provider.chat([{ role: 'user', content: 'hi' }], { ...OPTS, maxTokens: 800 })
    expect(create.mock.calls[1][0].max_tokens).toBe(800)
  })

  it('returns an empty string if the response has no message content', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [], usage: undefined })
    const { provider } = build(undefined, create)

    expect((await provider.chat([{ role: 'user', content: 'hi' }], OPTS)).text).toBe('')
  })
})
