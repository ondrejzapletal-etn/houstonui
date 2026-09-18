import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import type { TaskContext } from './task-context-builder.service'
import type { TaskIntent } from './task-intent-analyzer.service'
import { TaskResponseGeneratorService } from './task-response-generator.service'

describe('TaskResponseGeneratorService', () => {
  it('includes attendee emails in calendar context even when display names are present', async () => {
    const chat = jest.fn().mockResolvedValue('{"summary":"ok","proposals":[]}')
    const service = new TaskResponseGeneratorService({ chat } as unknown as AiGatewayService)
    const intent: TaskIntent = {
      topic: 'úterní schůzka s ČEZ',
      intentType: 'find',
      entities: ['ČEZ'],
      keywords: ['úterní schůzka'],
      needsFreshData: true,
      sources: ['calendar'],
      outputDescription: 'Dostupné informace o schůzce',
    }
    const context: TaskContext = {
      entities: [],
      kgContext: null,
      recentProposals: [],
      cachedIssues: [],
      clients: [],
      projects: [],
      liveData: {
        calendarEvents: [{
          id: 'evt-cez',
          summary: 'Nové formy strukturované komunikace',
          start: '2026-09-15T09:00:00Z',
          end: '2026-09-15T10:00:00Z',
          attendees: [{ email: 'david.levy@cez.cz', displayName: 'David Levý' }],
          allDay: false,
        }],
      },
    }

    await service.generate('user-1', 'Zjisti informace o úterní schůzce s ČEZ', intent, context, 'cs')

    const messages = chat.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages[1].content).toContain('David Levý <david.levy@cez.cz>')
  })
})