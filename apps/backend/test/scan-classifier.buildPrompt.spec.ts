import { Test } from '@nestjs/testing'
import { ScanClassifierService } from '../../src/scan/scan-classifier.service'
import { AiGatewayService } from '../../src/ai-gateway/ai-gateway.service'
import { estimateTokens, writeArtifact } from './utils/token-estimator'

describe('ScanClassifierService - buildPrompt (capture)', () => {
  let classifier: ScanClassifierService
  const aiMock = { chat: jest.fn() }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScanClassifierService,
        { provide: AiGatewayService, useValue: aiMock },
      ],
    }).compile()

    classifier = moduleRef.get(ScanClassifierService)
  })

  it('builds a large prompt and writes artifacts', async () => {
    const makeSlackChannel = (i: number) => ({
      channelId: `C${i}`,
      channelName: `chan-${i}`,
      messages: Array.from({ length: 200 }, (_, j) => ({ ts: `${j}`, userId: `U${j}`, text: 'x'.repeat(300) })),
    })

    const data: any = {
      gmail: { emails: Array.from({ length: 50 }, (_, i) => ({ messageId: `m${i}`, from: 'a@b', to: 'me', subject: 'S', receivedAt: new Date().toISOString(), snippet: 'y'.repeat(1000) })) },
      slack: { result: { channels: Array.from({ length: 6 }, (_, i) => makeSlackChannel(i)) } },
      calendar: { result: { events: Array.from({ length: 20 }, (_, i) => ({ start: new Date().toISOString(), end: new Date().toISOString(), summary: `Event ${i}`, attendees: [] })) } },
      jiraToday: { result: { issues: Array.from({ length: 10 }, (_, i) => ({ id: `J${i}`, worklogs: [] })) } },
    }

    const prompt = (classifier as any).buildPrompt(data) as string
    const chars = prompt.length
    const est = estimateTokens(chars)

    writeArtifact(`buildPrompt-${Date.now()}.txt`, prompt)
    writeArtifact(`buildPrompt-metrics-${Date.now()}.json`, { chars, estimated_tokens: est, messages_count: 2 })

    expect(chars).toBeGreaterThan(1000)
  })
})
