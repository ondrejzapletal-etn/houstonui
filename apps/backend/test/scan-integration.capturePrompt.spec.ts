import { Test } from '@nestjs/testing'
import request from 'supertest'
import { INestApplication } from '@nestjs/common'
import { AppModule } from '../../src/app.module'
import { ScanFetcherService } from '../../src/scan/scan-fetcher.service'
import { AiGatewayService } from '../../src/ai-gateway/ai-gateway.service'
import { estimateTokens, writeArtifact } from './utils/token-estimator'

describe('Scan integration - capture prompt', () => {
  let app: INestApplication
  const largeData = (() => {
    const makeSlackChannel = (i: number) => ({
      channelId: `C${i}`,
      channelName: `chan-${i}`,
      messages: Array.from({ length: 100 }, (_, j) => ({ ts: `${j}`, userId: `U${j}`, text: 'x'.repeat(300) })),
    })
    return {
      gmail: { emails: Array.from({ length: 30 }, (_, i) => ({ messageId: `m${i}`, from: 'a@b', to: 'me', subject: 'S', receivedAt: new Date().toISOString(), snippet: 'y'.repeat(800) })) },
      slack: { result: { channels: Array.from({ length: 4 }, (_, i) => makeSlackChannel(i)) } },
      calendar: { result: { events: [] } },
      jiraToday: { result: { issues: [] } },
    }
  })()

  const aiMock = { chat: jest.fn().mockResolvedValue('{"result":[]}') }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ScanFetcherService)
      .useValue({ fetchAll: async () => largeData })
      .overrideProvider(AiGatewayService)
      .useValue(aiMock)
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('triggers scan stream and captures prompt sent to AiGateway', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/scan/stream')
      .expect(200)

    expect(aiMock.chat).toHaveBeenCalled()
    const call = aiMock.chat.mock.calls[0]
    const messages = call[0] as any[]
    const model = call[1]?.model || 'unknown'
    const jsonMode = call[1]?.jsonMode ?? false
    const system = messages.find(m => m.role === 'system')?.content ?? ''
    const user = messages.find(m => m.role === 'user')?.content ?? ''
    const chars = user.length + system.length
    const est = estimateTokens(chars)

    writeArtifact(`scan-prompt-${Date.now()}.json`, { model, jsonMode, messages_count: messages.length, system_chars: system.length, user_chars: user.length, estimated_tokens: est })
    expect(chars).toBeGreaterThan(1000)
  })
})
