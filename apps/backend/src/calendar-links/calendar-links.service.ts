/**
 * CalendarLinksService
 *
 * Stores and retrieves the mapping between a Google Calendar event and a
 * Jira issue key. This powers the "pre-fill issue when logging work" UX:
 * the desktop reads the link on modal open and saves it after the user
 * successfully submits a worklog.
 *
 * One calendar event maps to exactly one Jira issue at any time.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { IssuesService } from '../issues/issues.service'
import { UpsertCalendarIssueLinkDto } from './dto/calendar-link.dto'

@Injectable()
export class CalendarLinksService {
  private readonly logger = new Logger(CalendarLinksService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
  ) {}

  async listAll(userId: string) {
    return this.prisma.calendarEventIssueLink.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async find(userId: string, calendarEventId: string, recurringEventId?: string) {
    const link = await this.prisma.calendarEventIssueLink.findUnique({
      where: { userId_calendarEventId: { userId, calendarEventId } },
    })
    if (link) return link

    // Fallback: for recurring events look up any saved binding for the same series
    if (recurringEventId) {
      const seriesLink = await this.prisma.calendarEventIssueLink.findFirst({
        where: { userId, recurringEventId },
        orderBy: { updatedAt: 'desc' },
      })
      if (seriesLink) return seriesLink
    }

    throw new NotFoundException(`No issue link found for event ${calendarEventId}`)
  }

  async upsert(userId: string, calendarEventId: string, dto: UpsertCalendarIssueLinkDto) {
    // Ensure the issue exists in local cache (upsert with empty summary if not present)
    const cachedIssue = await this.prisma.jiraIssue.findUnique({
      where: { userId_issueKey: { userId, issueKey: dto.issueKey } },
    })

    const link = await this.prisma.calendarEventIssueLink.upsert({
      where: { userId_calendarEventId: { userId, calendarEventId } },
      create: {
        userId,
        calendarEventId,
        issueKey: dto.issueKey,
        jiraIssueId: cachedIssue?.id ?? null,
        projectId: dto.projectId ?? cachedIssue?.projectId ?? null,
        recurringEventId: dto.recurringEventId ?? null,
      },
      update: {
        issueKey: dto.issueKey,
        jiraIssueId: cachedIssue?.id ?? null,
        projectId: dto.projectId ?? cachedIssue?.projectId ?? undefined,
        recurringEventId: dto.recurringEventId ?? undefined,
      },
    })
    this.logger.debug(`Calendar link upserted event=${calendarEventId} issue=${dto.issueKey} userId=${userId}`)
    return link
  }

  /**
   * Given a list of email addresses, extract non-generic domains, find a matching
   * Client, and return up to 5 recent active JiraIssues from that client's projects.
   * Returns { client, unknownDomain, issues } where unknownDomain is the detected
   * domain when no Client matched (so the frontend can offer to create one).
   */
  async suggestIssues(userId: string, emails: string[]) {
    const GENERIC_DOMAINS = new Set([
      'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
      'yahoo.com', 'yahoo.cz', 'seznam.cz', 'centrum.cz', 'atlas.cz', 'email.cz',
      'icloud.com', 'me.com', 'apple.com', 'msn.com', 'aol.com', 'ymail.com',
      'post.cz', 'inbox.com', 'mail.com',
    ])

    const domains = [...new Set(
      emails
        .map(e => e.split('@')[1]?.toLowerCase().trim())
        .filter((d): d is string => !!d && !GENERIC_DOMAINS.has(d)),
    )]

    if (!domains.length) return { client: null, unknownDomain: null, issues: [] }

    const client = await this.prisma.client.findFirst({
      where: { userId, domain: { in: domains } },
    })

    if (!client) {
      return { client: null, unknownDomain: domains[0], issues: [] }
    }

    const projects = await this.prisma.project.findMany({
      where: { clientId: client.id },
      select: { id: true },
    })

    if (!projects.length) return { client: { id: client.id, name: client.name }, unknownDomain: null, issues: [] }

    const issues = await this.prisma.jiraIssue.findMany({
      where: { projectId: { in: projects.map(p => p.id) }, active: true },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { issueKey: true, summary: true },
    })

    return { client: { id: client.id, name: client.name }, unknownDomain: null, issues }
  }

  async remove(userId: string, calendarEventId: string) {
    const link = await this.prisma.calendarEventIssueLink.findUnique({
      where: { userId_calendarEventId: { userId, calendarEventId } },
    })
    if (!link) throw new NotFoundException(`No issue link found for event ${calendarEventId}`)
    await this.prisma.calendarEventIssueLink.delete({
      where: { userId_calendarEventId: { userId, calendarEventId } },
    })
  }
}
