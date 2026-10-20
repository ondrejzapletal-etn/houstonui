import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { CalendarLinksService } from './calendar-links.service'
import { PrismaService } from '../prisma/prisma.service'
import { IssuesService } from '../issues/issues.service'

const mockPrisma = {
  calendarEventIssueLink: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  client: {
    findFirst: jest.fn(),
  },
  project: {
    findMany: jest.fn(),
  },
  jiraIssue: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
}

const mockIssues = {
  upsertFromKey: jest.fn(),
  refreshSummary: jest.fn(),
}

describe('CalendarLinksService', () => {
  let service: CalendarLinksService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarLinksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IssuesService, useValue: mockIssues },
      ],
    }).compile()

    service = module.get(CalendarLinksService)
  })

  describe('find', () => {
    it('returns exact event link when it exists', async () => {
      const exactLink = {
        id: 'link-1',
        userId: 'user-1',
        calendarEventId: 'event-1',
        issueKey: 'TTIME-1',
      }

      mockPrisma.calendarEventIssueLink.findUnique.mockResolvedValueOnce(exactLink)

      const result = await service.find('user-1', 'event-1', 'series-1')

      expect(result).toBe(exactLink)
      expect(mockPrisma.calendarEventIssueLink.findUnique).toHaveBeenCalledWith({
        where: { userId_calendarEventId: { userId: 'user-1', calendarEventId: 'event-1' } },
      })
      expect(mockPrisma.calendarEventIssueLink.findFirst).not.toHaveBeenCalled()
    })

    it('falls back to the most recently updated recurring-series link', async () => {
      const seriesLink = {
        id: 'link-2',
        userId: 'user-1',
        calendarEventId: 'event-old',
        issueKey: 'TTIME-1',
      }

      mockPrisma.calendarEventIssueLink.findUnique.mockResolvedValueOnce(null)
      mockPrisma.calendarEventIssueLink.findFirst.mockResolvedValueOnce(seriesLink)

      const result = await service.find('user-1', 'event-new', 'series-1')

      expect(result).toBe(seriesLink)
      expect(mockPrisma.calendarEventIssueLink.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', recurringEventId: 'series-1' },
        orderBy: { updatedAt: 'desc' },
      })
    })

    it('throws NotFoundException when no exact or recurring link exists', async () => {
      mockPrisma.calendarEventIssueLink.findUnique.mockResolvedValueOnce(null)
      mockPrisma.calendarEventIssueLink.findFirst.mockResolvedValueOnce(null)

      await expect(service.find('user-1', 'event-1', 'series-1')).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('suggestIssues', () => {
    it('enriches an issue with an empty cached summary before returning it', async () => {
      mockPrisma.client.findFirst.mockResolvedValueOnce({ id: 'client-1', name: 'Operativa' })
      mockPrisma.project.findMany.mockResolvedValueOnce([{ id: 'project-1' }])
      mockPrisma.jiraIssue.findMany.mockResolvedValueOnce([{ issueKey: 'TIME-2', summary: '' }])
      mockIssues.refreshSummary.mockResolvedValueOnce('Příprava reportu')

      const result = await service.suggestIssues('user-1', ['user@operativa.cz'])

      expect(mockIssues.refreshSummary).toHaveBeenCalledWith('user-1', 'TIME-2')
      expect(result).toEqual({
        client: { id: 'client-1', name: 'Operativa' },
        unknownDomain: null,
        issues: [{ issueKey: 'TIME-2', summary: 'Příprava reportu' }],
      })
    })
  })
})
