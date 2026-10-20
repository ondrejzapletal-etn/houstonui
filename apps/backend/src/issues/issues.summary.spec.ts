import { Test } from '@nestjs/testing'
import { IssuesService } from './issues.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProjectsService } from '../projects/projects.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { JiraService } from '../connectors/jira/jira.service'

describe('IssuesService summary lookup', () => {
  const prisma = { jiraIssue: { findUnique: jest.fn(), updateMany: jest.fn() } }
  const jira = { getIssueDetails: jest.fn() }
  let service: IssuesService

  beforeEach(async () => {
    jest.resetAllMocks()
    const module = await Test.createTestingModule({
      providers: [
        IssuesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectsService, useValue: {} },
        { provide: KnowledgeService, useValue: {} },
        { provide: JiraService, useValue: jira },
      ],
    }).compile()
    service = module.get(IssuesService)
  })

  it('returns an existing user-scoped name without calling Jira', async () => {
    prisma.jiraIssue.findUnique.mockResolvedValue({ summary: 'Operativa' })
    await expect(service.resolveSummary('user-1', 'CEZNFK-1')).resolves.toBe('Operativa')
    expect(prisma.jiraIssue.findUnique).toHaveBeenCalledWith({
      where: { userId_issueKey: { userId: 'user-1', issueKey: 'CEZNFK-1' } },
      select: { summary: true },
    })
    expect(jira.getIssueDetails).not.toHaveBeenCalled()
  })

  it.each([null, { summary: '' }, { summary: '   ' }, { summary: 'TIME-2' }])(
    'resolves a missing or placeholder name from Jira: %p', async (cached) => {
      prisma.jiraIssue.findUnique.mockResolvedValue(cached)
      jira.getIssueDetails.mockResolvedValue({ summary: 'Reporting' })
      await expect(service.resolveSummary('user-1', 'TIME-2')).resolves.toBe('Reporting')
      expect(jira.getIssueDetails).toHaveBeenCalledWith('user-1', 'TIME-2')
      expect(prisma.jiraIssue.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', issueKey: 'TIME-2' },
        data: { summary: 'Reporting', lastSyncedAt: expect.any(Date) },
      })
    },
  )

  it('returns null when Jira cannot resolve the issue', async () => {
    prisma.jiraIssue.findUnique.mockResolvedValue(null)
    jira.getIssueDetails.mockResolvedValue(null)
    await expect(service.resolveSummary('user-1', 'TIME-2')).resolves.toBeNull()
    expect(prisma.jiraIssue.updateMany).not.toHaveBeenCalled()
  })
})