import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { KnowledgeService } from './knowledge.service'
import type { ScanSourceData } from '../scan/scan-fetcher.service'

// Extracts Jira-style issue keys (e.g. "ROSS-5268", "TTIME-2") from text
function extractIssueKeys(text: string): string[] {
  const matches = text.match(/\b([A-Z][A-Z0-9]+-\d+)\b/g) ?? []
  return [...new Set(matches)]
}

// Parses "Jan Novák <jan@client.cz>" or "jan@client.cz"
function parseEmailAddress(raw: string): { name: string; email: string } {
  const match = raw.trim().match(/^(.+?)\s*<([^>]+)>$/)
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() }
  return { name: raw.trim(), email: raw.trim().toLowerCase() }
}

// Extracts domain from email, strips common generic providers
const GENERIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'])
function orgFromEmail(email: string): string | undefined {
  const domain = email.split('@')[1]
  if (!domain || GENERIC_DOMAINS.has(domain)) return undefined
  return domain
}

@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
  ) {}

  // ── Scan ingestion (called fire-and-forget from ScanService) ──────────────

  async ingestScanData(userId: string, scanRunId: string, data: ScanSourceData): Promise<void> {
    try {
      await this.writeObservations(userId, scanRunId, data)
    } catch (err) {
      this.logger.error(`Observation write failed scanRun=${scanRunId}: ${err instanceof Error ? err.message : String(err)}`)
    }

    void this.resolveEntities(userId, scanRunId, data).catch((err) =>
      this.logger.error(`Entity resolution failed scanRun=${scanRunId}: ${err instanceof Error ? err.message : String(err)}`),
    )
  }

  // ── Retroactive sync of existing DB records ───────────────────────────────

  /**
   * One-shot idempotent sync: reads existing clients/projects/jira_issues
   * and creates knowledge entities for each. Safe to call multiple times.
   */
  async syncExistingDomainData(userId: string): Promise<{ clients: number; projects: number; issues: number }> {
    const [clients, projects, issues] = await Promise.all([
      this.prisma.client.findMany({ where: { userId } }),
      this.prisma.project.findMany({ where: { userId } }),
      this.prisma.jiraIssue.findMany({ where: { userId, active: true } }),
    ])

    await Promise.all(clients.map(async (c) => {
      const entity = await this.knowledge.resolveEntity(userId, 'internal', 'client', c.id, {
        type: 'organization',
        title: c.name,
        description: c.notes ?? undefined,
      })
      if (c.domain) await this.knowledge.upsertFactInternal(entity.id, 'domain', c.domain, 'internal')
    }))

    await Promise.all(projects.map(async (p) => {
      const entity = await this.knowledge.resolveEntity(userId, 'internal', 'project', p.id, {
        type: 'project',
        title: p.name,
        status: p.active ? 'active' : 'inactive',
      })
      const facts: Promise<unknown>[] = []
      if (p.jiraProjectKey) {
        facts.push(this.knowledge.upsertFactInternal(entity.id, 'jiraProjectKey', p.jiraProjectKey, 'internal'))
      }
      if (p.clientId) {
        facts.push(
          this.knowledge.findByExternalLink('internal', 'client', p.clientId).then((clientEntity) => {
            if (clientEntity) {
              return this.knowledge.createRelation(userId, {
                fromEntityId: entity.id,
                toEntityId: clientEntity.id,
                relationType: 'PART_OF',
              }).catch(() => {})
            }
          }),
        )
      }
      await Promise.all(facts)
    }))

    await Promise.all(issues.map(async (issue) => {
      const entity = await this.knowledge.resolveEntity(userId, 'jira', 'issue', issue.issueKey, {
        type: 'task',
        title: issue.summary,
        status: issue.active ? 'open' : 'closed',
      })
      const facts: Promise<unknown>[] = [
        this.knowledge.upsertFactInternal(entity.id, 'issueKey', issue.issueKey, 'jira'),
        this.knowledge.upsertFactInternal(entity.id, 'summary', issue.summary, 'jira'),
      ]
      if (issue.projectId) {
        facts.push(
          this.knowledge.findByExternalLink('internal', 'project', issue.projectId).then((projectEntity) => {
            if (projectEntity) {
              return this.knowledge.createRelation(userId, {
                fromEntityId: entity.id,
                toEntityId: projectEntity.id,
                relationType: 'PART_OF',
              }).catch(() => {})
            }
          }),
        )
      }
      await Promise.all(facts)
    }))

    this.logger.log(`Domain sync done userId=${userId}: ${clients.length} clients, ${projects.length} projects, ${issues.length} issues`)
    return { clients: clients.length, projects: projects.length, issues: issues.length }
  }

  // ── Observations ──────────────────────────────────────────────────────────

  private async writeObservations(userId: string, scanRunId: string, data: ScanSourceData) {
    const rows: Prisma.KnowledgeObservationCreateManyInput[] = []
    const now = new Date()

    for (const email of data.gmail.emails) {
      rows.push({
        userId, scanRunId,
        isPrimary: true,
        sourceSystem: 'gmail', sourceType: 'email', sourceRef: email.messageId,
        observedAt: email.receivedAt ? new Date(email.receivedAt) : now,
        content: [email.subject, email.from, email.snippet].filter(Boolean).join('\n'),
        rawPayload: email as object,
      })
    }

    for (const channel of data.slack.result.channels) {
      for (const msg of channel.messages) {
        rows.push({
          userId, scanRunId,
          isPrimary: true,
          sourceSystem: 'slack', sourceType: 'message', sourceRef: `${channel.channelId}:${msg.ts}`,
          observedAt: new Date(parseFloat(msg.ts) * 1000),
          content: msg.text,
          rawPayload: { channel: channel.channelId, channelName: channel.channelName, text: msg.text, ts: msg.ts, userId: msg.userId, userName: msg.userName } as object,
        })
      }
    }

    for (const event of data.calendar.result.events) {
      rows.push({
        userId, scanRunId,
        isPrimary: true,
        sourceSystem: 'calendar', sourceType: 'event', sourceRef: event.id,
        observedAt: event.start ? new Date(event.start) : now,
        content: [event.summary, event.location].filter(Boolean).join(' — '),
        rawPayload: event as object,
      })
    }

    if (rows.length === 0) return
    await this.prisma.knowledgeObservation.createMany({ data: rows, skipDuplicates: true })
    this.logger.log(`Wrote ${rows.length} observations scanRun=${scanRunId}`)
  }

  // ── Entity resolution ─────────────────────────────────────────────────────

  private async resolveEntities(userId: string, scanRunId: string, data: ScanSourceData) {
    let resolved = 0

    // Gmail → conversation + person (sender)
    for (const email of data.gmail.emails) {
      const conv = await this.knowledge.resolveEntity(userId, 'gmail', 'email', email.messageId, {
        type: 'conversation',
        title: email.subject ?? '(no subject)',
        description: email.snippet,
      })
      const sender = parseEmailAddress(email.from)
      const senderEntity = await this.knowledge.resolveEntity(userId, 'gmail', 'person', sender.email, {
        type: 'person',
        title: sender.name || sender.email,
      })
      const org = orgFromEmail(sender.email)
      await Promise.all([
        this.knowledge.upsertFactInternal(conv.id, 'from', email.from, 'gmail'),
        this.knowledge.upsertFactInternal(conv.id, 'receivedAt', email.receivedAt, 'gmail'),
        email.subject ? this.knowledge.upsertFactInternal(conv.id, 'subject', email.subject, 'gmail') : Promise.resolve(),
        this.knowledge.upsertFactInternal(senderEntity.id, 'email', sender.email, 'gmail'),
        org ? this.knowledge.upsertFactInternal(senderEntity.id, 'organization', org, 'gmail') : Promise.resolve(),
        this.knowledge.createRelation(userId, {
          fromEntityId: conv.id, toEntityId: senderEntity.id, relationType: 'MENTIONS',
        }).catch(() => {}),
        this.prisma.knowledgeObservation.updateMany({
          where: { scanRunId, sourceSystem: 'gmail', sourceRef: email.messageId },
          data: { processed: true, entityId: conv.id },
        }),
      ])
      resolved += 2

      // Link email to mentioned Jira task entities
      const emailText = [email.subject ?? '', email.snippet ?? ''].join(' ')
      for (const key of extractIssueKeys(emailText)) {
        const taskEntity = await this.knowledge.findByExternalLink('jira', 'issue', key)
        if (taskEntity) {
          await this.knowledge.addObservation(userId, {
            entityId: taskEntity.id,
            sourceSystem: 'gmail',
            sourceType: 'email',
            sourceRef: email.messageId,
            observedAt: email.receivedAt ? new Date(email.receivedAt) : new Date(),
            content: `Email od ${sender.name || sender.email}: ${(email.subject ?? '').slice(0, 120)}`,
          })
        }
      }
    }

    // Slack → conversation + person (author)
    for (const channel of data.slack.result.channels) {
      for (const msg of channel.messages) {
        const ref = `${channel.channelId}:${msg.ts}`
        const conv = await this.knowledge.resolveEntity(userId, 'slack', 'message', ref, {
          type: 'conversation',
          title: (msg.text ?? '').slice(0, 80) || '(slack message)',
        })
        const authorEntity = await this.knowledge.resolveEntity(userId, 'slack', 'person', msg.userId, {
          type: 'person',
          title: msg.userName || msg.userId,
        })
        await Promise.all([
          this.knowledge.upsertFactInternal(conv.id, 'channel', channel.channelName, 'slack'),
          this.knowledge.upsertFactInternal(conv.id, 'ts', msg.ts, 'slack'),
          this.knowledge.upsertFactInternal(authorEntity.id, 'slackUserId', msg.userId, 'slack'),
          this.knowledge.upsertFactInternal(authorEntity.id, 'slackUsername', msg.userName || msg.userId, 'slack'),
          this.knowledge.createRelation(userId, {
            fromEntityId: conv.id, toEntityId: authorEntity.id, relationType: 'MENTIONS',
          }).catch(() => {}),
          this.prisma.knowledgeObservation.updateMany({
            where: { scanRunId, sourceSystem: 'slack', sourceRef: ref },
            data: { processed: true, entityId: conv.id },
          }),
        ])
        resolved += 2

        // Link Slack message to mentioned Jira task entities
        for (const key of extractIssueKeys(msg.text ?? '')) {
          const taskEntity = await this.knowledge.findByExternalLink('jira', 'issue', key)
          if (taskEntity) {
            await this.knowledge.addObservation(userId, {
              entityId: taskEntity.id,
              sourceSystem: 'slack',
              sourceType: 'message',
              sourceRef: ref,
              observedAt: new Date(parseFloat(msg.ts) * 1000),
              content: `Slack od ${msg.userName || msg.userId}: ${(msg.text ?? '').slice(0, 120)}`,
            })
          }
        }
      }
    }

    // Calendar → conversation + person per attendee
    for (const event of data.calendar.result.events) {
      const conv = await this.knowledge.resolveEntity(userId, 'calendar', 'event', event.id, {
        type: 'conversation',
        title: event.summary ?? '(calendar event)',
        status: 'scheduled',
      })
      const facts: Promise<void>[] = [
        event.start ? this.knowledge.upsertFactInternal(conv.id, 'start', event.start, 'calendar') : Promise.resolve(),
        event.end ? this.knowledge.upsertFactInternal(conv.id, 'end', event.end, 'calendar') : Promise.resolve(),
        event.location ? this.knowledge.upsertFactInternal(conv.id, 'location', event.location, 'calendar') : Promise.resolve(),
        this.prisma.knowledgeObservation.updateMany({
          where: { scanRunId, sourceSystem: 'calendar', sourceRef: event.id },
          data: { processed: true, entityId: conv.id },
        }).then(() => {}),
      ]
      for (const attendee of event.attendees ?? []) {
        const attendeeEntity = await this.knowledge.resolveEntity(userId, 'calendar', 'person', attendee.email.toLowerCase(), {
          type: 'person',
          title: attendee.displayName || attendee.email,
        })
        facts.push(
          this.knowledge.upsertFactInternal(attendeeEntity.id, 'email', attendee.email.toLowerCase(), 'calendar'),
          this.knowledge.createRelation(userId, {
            fromEntityId: conv.id, toEntityId: attendeeEntity.id, relationType: 'MENTIONS',
          }).catch(() => {}).then(() => {}),
        )
        resolved++
      }
      await Promise.all(facts)
      resolved++
    }

    if (resolved > 0) {
      this.logger.log(`Resolved ${resolved} entities scanRun=${scanRunId}`)
    }
  }
}
