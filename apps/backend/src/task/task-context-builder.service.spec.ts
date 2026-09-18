import { Test, TestingModule } from '@nestjs/testing'
import { CalendarService } from '../connectors/calendar/calendar.service'
import { GmailService } from '../connectors/gmail/gmail.service'
import { SlackService } from '../connectors/slack/slack.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { PrismaService } from '../prisma/prisma.service'
import { TaskContextBuilderService } from './task-context-builder.service'
import type { TaskIntent } from './task-intent-analyzer.service'

describe('TaskContextBuilderService', () => {
  it('fetches an explicitly requested calendar source without the needsFreshData flag', async () => {
    const calendar = { searchEvents: jest.fn().mockResolvedValue([]) }
    const prisma = {
      proposal: { findMany: jest.fn().mockResolvedValue([]) },
      jiraIssue: { findMany: jest.fn().mockResolvedValue([]) },
      client: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const knowledge = {
      searchEntities: jest.fn().mockResolvedValue([]),
      getClassifierContext: jest.fn().mockResolvedValue(null),
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskContextBuilderService,
        { provide: PrismaService, useValue: prisma },
        { provide: KnowledgeService, useValue: knowledge },
        { provide: GmailService, useValue: { searchEmails: jest.fn() } },
        { provide: SlackService, useValue: { searchMessages: jest.fn() } },
        { provide: CalendarService, useValue: calendar },
      ],
    }).compile()
    const service = module.get(TaskContextBuilderService)
    const intent: TaskIntent = {
      topic: 'úterní schůzka s ČEZ',
      intentType: 'find',
      entities: ['ČEZ'],
      keywords: ['úterní schůzka'],
      needsFreshData: false,
      sources: ['kg', 'recent_scans', 'calendar'],
      outputDescription: 'Dostupné informace o schůzce',
    }

    const context = await service.build('user-1', intent, true)

    expect(calendar.searchEvents).toHaveBeenCalledWith('user-1', 'ČEZ úterní schůzka')
    expect(context.liveData?.calendarEvents).toEqual([])
  })
})