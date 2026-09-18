import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { AiGatewayService } from './ai-gateway.service'
import { AiProviderResolver } from './ai-provider-resolver.service'
import { AiUsageLoggerService } from './ai-usage-logger.service'
import { OpenAiProvider } from './providers/openai.provider'
import { AnthropicProvider } from './providers/anthropic.provider'

// The providers own the SDK wire shapes (covered in their own specs); here we
// test what the gateway itself decides: which provider runs, and what comes back.
jest.mock('./providers/openai.provider')
jest.mock('./providers/anthropic.provider')

const MockedOpenAi = OpenAiProvider as jest.MockedClass<typeof OpenAiProvider>
const MockedAnthropic = AnthropicProvider as jest.MockedClass<typeof AnthropicProvider>

describe('AiGatewayService', () => {
  let service: AiGatewayService
  let openAiChat: jest.Mock
  let anthropicChat: jest.Mock
  let resolve: jest.Mock
  let record: jest.Mock
  let env: Record<string, string | undefined>

  beforeEach(async () => {
    jest.clearAllMocks()
    env = { OPENAI_API_KEY: 'sk-openai', ANTHROPIC_API_KEY: 'sk-ant' }

    openAiChat = jest.fn().mockResolvedValue({ text: 'openai says hi', inputTokens: 10, outputTokens: 4 })
    anthropicChat = jest
      .fn()
      .mockResolvedValue({ text: 'anthropic says hi', inputTokens: 12, outputTokens: 6 })

    MockedOpenAi.mockImplementation(
      () =>
        ({
          name: 'OPENAI',
          chat: openAiChat,
          modelFor: (q: string) => (q === 'high' ? 'gpt-4o' : 'gpt-4o-mini'),
        }) as unknown as OpenAiProvider,
    )
    MockedAnthropic.mockImplementation(
      () =>
        ({
          name: 'ANTHROPIC',
          chat: anthropicChat,
          modelFor: (q: string) => (q === 'high' ? 'claude-sonnet-5' : 'claude-haiku-4-5'),
        }) as unknown as AnthropicProvider,
    )

    resolve = jest.fn().mockResolvedValue('OPENAI')
    record = jest.fn().mockResolvedValue(undefined)

    const module = await Test.createTestingModule({
      providers: [
        AiGatewayService,
        { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
        { provide: AiProviderResolver, useValue: { resolve } },
        { provide: AiUsageLoggerService, useValue: { record } },
      ],
    }).compile()

    service = module.get(AiGatewayService)
  })

  it('returns the assistant text from the resolved provider', async () => {
    const result = await service.chat([{ role: 'user', content: 'hello' }], { userId: 'u1' })

    expect(result).toBe('openai says hi')
    expect(resolve).toHaveBeenCalledWith('u1')
    expect(anthropicChat).not.toHaveBeenCalled()
  })

  it('routes to Anthropic when that is the user preference', async () => {
    resolve.mockResolvedValue('ANTHROPIC')

    const result = await service.chat([{ role: 'user', content: 'hello' }], { userId: 'u1' })

    expect(result).toBe('anthropic says hi')
    expect(openAiChat).not.toHaveBeenCalled()
  })

  it('lets an explicit provider option win over the user preference', async () => {
    resolve.mockResolvedValue('OPENAI')

    await service.chat([{ role: 'user', content: 'hello' }], {
      userId: 'u1',
      provider: 'ANTHROPIC',
    })

    expect(anthropicChat).toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('applies the documented option defaults', async () => {
    await service.chat([{ role: 'user', content: 'hello' }])

    expect(openAiChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'hello' }],
      expect.objectContaining({ temperature: 0.2, jsonMode: false, quality: 'fast' }),
    )
  })

  it('forwards quality, temperature, jsonMode and maxTokens', async () => {
    await service.chat([{ role: 'user', content: 'hello' }], {
      quality: 'high',
      temperature: 0.3,
      jsonMode: true,
      maxTokens: 4000,
    })

    expect(openAiChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        quality: 'high',
        temperature: 0.3,
        jsonMode: true,
        maxTokens: 4000,
      }),
    )
  })

  it('salvages fenced JSON in jsonMode', async () => {
    openAiChat.mockResolvedValue({
      text: '```json\n{"result":"ok"}\n```',
      inputTokens: 1,
      outputTokens: 1,
    })

    const result = await service.chat([{ role: 'user', content: 'hello' }], { jsonMode: true })

    expect(result).toBe('{"result":"ok"}')
    expect(JSON.parse(result)).toEqual({ result: 'ok' })
  })

  it('leaves non-JSON replies alone when jsonMode is off', async () => {
    openAiChat.mockResolvedValue({
      text: '```json\n{"result":"ok"}\n```',
      inputTokens: 1,
      outputTokens: 1,
    })

    const result = await service.chat([{ role: 'user', content: 'hello' }])

    expect(result).toBe('```json\n{"result":"ok"}\n```')
  })

  it('builds each provider once and reuses it', async () => {
    await service.chat([{ role: 'user', content: 'a' }])
    await service.chat([{ role: 'user', content: 'b' }])

    expect(MockedOpenAi).toHaveBeenCalledTimes(1)
  })

  // A deployment with only one key must still boot – providers are lazy.
  it('does not construct any provider until the first call', () => {
    expect(MockedOpenAi).not.toHaveBeenCalled()
    expect(MockedAnthropic).not.toHaveBeenCalled()
  })

  describe('usage logging', () => {
    it('records tokens against the userId, provider, model and quality actually used', async () => {
      resolve.mockResolvedValue('ANTHROPIC')

      await service.chat([{ role: 'user', content: 'hello' }], { userId: 'u1', quality: 'high' })

      expect(record).toHaveBeenCalledWith({
        userId: 'u1',
        provider: 'ANTHROPIC',
        model: 'claude-sonnet-5',
        quality: 'high',
        inputTokens: 12,
        outputTokens: 6,
      })
    })

    // No userId means no one to attribute the cost to – logging is a no-op, not a crash.
    it('does not record usage when there is no userId', async () => {
      await service.chat([{ role: 'user', content: 'hello' }], { provider: 'OPENAI' })

      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('settings helpers', () => {
    it('reports only providers that have a key configured', () => {
      expect(service.availableProviders()).toEqual(['OPENAI', 'ANTHROPIC'])

      env.OPENAI_API_KEY = undefined
      expect(service.availableProviders()).toEqual(['ANTHROPIC'])
    })

    it('reports the model ids per tier', () => {
      expect(service.modelsFor('ANTHROPIC')).toEqual({
        fast: 'claude-haiku-4-5',
        high: 'claude-sonnet-5',
      })
    })

    // Informational read – must not throw just because a key is missing.
    it('reports empty models for a provider with no API key', () => {
      MockedOpenAi.mockImplementation(() => {
        throw new Error('OPENAI_API_KEY is not set')
      })

      expect(service.modelsFor('OPENAI')).toEqual({ fast: '', high: '' })
    })
  })
})
