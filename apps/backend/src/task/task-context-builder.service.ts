import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { GmailService, GmailScanEmail } from '../connectors/gmail/gmail.service'
import { SlackService, SlackSearchMessage } from '../connectors/slack/slack.service'
import { CalendarService, CalendarEvent } from '../connectors/calendar/calendar.service'
import type { TaskIntent } from './task-intent-analyzer.service'

export interface TaskContext {
  entities: Array<{ id: string; type: string; title: string; description?: string | null; status?: string | null }>
  kgContext: {
    contacts: { name: string; email?: string; organization?: string }[]
    tasks: { issueKey: string; summary: string; status?: string }[]
    recentOutcomes: { title: string; proposalStatus: string; tier: number }[]
  } | null
  recentProposals: Array<{
    system: string
    tier: number
    summary: string
    detail: string | null
    originalMessage: string | null
    status: string
    createdAt: Date
    issueKey: string | null
  }>
  cachedIssues: Array<{ issueKey: string; summary: string }>
  clients: Array<{ id: string; name: string; domain: string | null }>
  projects: Array<{ id: string; name: string; jiraProjectKey: string | null }>
  liveData?: {
    searchTerms?: string[]
    recentEmails?: GmailScanEmail[]
    recentSlack?: SlackSearchMessage[]
    calendarEvents?: CalendarEvent[]
  }
}

@Injectable()
export class TaskContextBuilderService {
  private readonly logger = new Logger(TaskContextBuilderService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly gmail: GmailService,
    private readonly slack: SlackService,
    private readonly calendar: CalendarService,
  ) {}

  async build(userId: string, intent: TaskIntent, allowLiveData: boolean): Promise<TaskContext> {
    const keywords = (intent.keywords ?? []).slice(0, 6)

    const [entityResults, kgContext, recentProposals, cachedIssues, clients, projects] =
      await Promise.all([
        this.searchEntities(userId, keywords),
        this.knowledge.getClassifierContext(userId).catch(() => null),
        this.fetchRelevantProposals(userId, intent.entities, intent.keywords),
        this.prisma.jiraIssue.findMany({
          where: { userId, active: true },
          select: { issueKey: true, summary: true },
          take: 50,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.client.findMany({
          where: { userId },
          select: { id: true, name: true, domain: true },
        }),
        this.prisma.project.findMany({
          where: { userId, active: true },
          select: { id: true, name: true, jiraProjectKey: true },
        }),
      ])

    let liveData: TaskContext['liveData'] | undefined
    const hasLiveSource = (intent.sources ?? []).some(
      (source) => source !== 'kg' && source !== 'recent_scans',
    )
    if (allowLiveData && (intent.needsFreshData || hasLiveSource)) {
      liveData = await this.fetchLiveData(userId, intent.sources ?? [], intent.entities, intent.keywords)
    }

    return {
      entities: entityResults,
      kgContext,
      recentProposals,
      cachedIssues,
      clients,
      projects,
      liveData,
    }
  }

  private async searchEntities(
    userId: string,
    keywords: string[],
  ): Promise<TaskContext['entities']> {
    const results = await Promise.all(
      keywords.map((kw) => this.knowledge.searchEntities(userId, kw).catch(() => [])),
    )
    const seen = new Set<string>()
    return results
      .flat()
      .filter((e) => !seen.has(e.id) && seen.add(e.id))
      .map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        description: e.description,
        status: e.status,
      }))
  }

  private async fetchRelevantProposals(
    userId: string,
    entities: string[],
    keywords: string[],
  ): Promise<TaskContext['recentProposals']> {
    const searchTerms = [...entities, ...keywords].filter(Boolean)

    // If we have specific search terms, try to find proposals that mention them
    if (searchTerms.length > 0) {
      const orClauses = searchTerms.flatMap((term) => [
        { summary: { contains: term, mode: 'insensitive' as const } },
        { detail: { contains: term, mode: 'insensitive' as const } },
        { originalMessage: { contains: term, mode: 'insensitive' as const } },
      ])

      const [relevant, recent] = await Promise.all([
        this.prisma.proposal.findMany({
          where: { userId, OR: orClauses },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: {
            system: true, tier: true, summary: true, detail: true,
            originalMessage: true, status: true, createdAt: true, issueKey: true,
          },
        }),
        this.prisma.proposal.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            system: true, tier: true, summary: true, detail: true,
            originalMessage: true, status: true, createdAt: true, issueKey: true,
          },
        }),
      ])

      // Merge: relevant first, then fill up with recent (deduplicated by summary)
      const seen = new Set(relevant.map((p) => p.summary))
      return [...relevant, ...recent.filter((p) => !seen.has(p.summary))]
    }

    return this.prisma.proposal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        system: true, tier: true, summary: true, detail: true,
        originalMessage: true, status: true, createdAt: true, issueKey: true,
      },
    })
  }

  private async fetchLiveData(
    userId: string,
    sources: string[],
    entities: string[],
    keywords: string[],
  ): Promise<TaskContext['liveData']> {
    const result: TaskContext['liveData'] = {}
    const searchTerms = [...new Set([...entities, ...keywords])].filter(Boolean).slice(0, 5)
    result.searchTerms = searchTerms

    const tasks: Promise<void>[] = []

    if (sources.includes('gmail')) {
      tasks.push(
        this.gmail
          .searchEmails(userId, searchTerms)
          .then((emails) => { result.recentEmails = emails })
          .catch((err) => {
            this.logger.warn(`Gmail search failed: ${err instanceof Error ? err.message : String(err)}`)
          }),
      )
    }

    if (sources.includes('slack')) {
      const slackQuery = searchTerms.join(' OR ')
      tasks.push(
        this.slack
          .searchMessages(userId, slackQuery)
          .then((messages) => { result.recentSlack = messages })
          .catch((err) => {
            this.logger.warn(`Slack search failed: ${err instanceof Error ? err.message : String(err)}`)
          }),
      )
    }

    if (sources.includes('calendar')) {
      const calendarQuery = searchTerms.join(' ')
      tasks.push(
        this.calendar
          .searchEvents(userId, calendarQuery)
          .then((events) => { result.calendarEvents = events })
          .catch((err) => {
            this.logger.warn(`Calendar search failed: ${err instanceof Error ? err.message : String(err)}`)
          }),
      )
    }

    await Promise.all(tasks)
    return result
  }
}
