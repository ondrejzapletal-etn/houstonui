/**
 * ScanService
 *
 * Orchestrates the scan lifecycle:
 *  1. Creates a ScanRun record in DB
 *  2. Fetches data from all connectors (via ScanFetcherService)
 *  3. Classifies with LLM (via ScanClassifierService)
 *  4. Persists Proposals in DB
 *  5. Emits SSE events throughout the process
 *
 * SSE events are emitted via an AsyncGenerator that the controller streams.
 * Autonomy Level 1 – no auto-execution, every Tier 1-2 item becomes a Proposal.
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, ScanStatus, ProposalStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { UsersService } from '../users/users.service'
import { TimeSavedService } from '../users/time-saved.service'
import { ScanFetcherService } from './scan-fetcher.service'
import { ScanClassifierService } from './scan-classifier.service'
import { isPotentialGoogleDocsCommentNotification } from '../connectors/gmail/google-docs-notification'
import { KnowledgeIngestionService } from '../knowledge/knowledge-ingestion.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { evaluateProposalRelevance } from './scan-relevance.policy'
import type {
  ScanEvent,
  ScanProgressEvent,
  ScanLogEvent,
  ScanProposalEvent,
  ScanAutoReadSuggestionsEvent,
  AutoReadSuggestionItem,
  ScanCompletedEvent,
  ScanErrorEvent,
  ScanPhase,
} from './dto/scan-event.dto'

export { ScanEvent }

interface ScanSummary {
  tierCounts: Record<number, number>
  totalItems: number
  proposalCount: number
  sources: Record<string, number>
}

export interface ScanStatusSnapshot {
  scanRunId: string
  status: ScanStatus
  phase: ScanPhase
  message: string | null
  startedAt: string
  completedAt: string | null
  summary: ScanSummary | null
  proposals: ScanProposalEvent['proposal'][]
  autoReadSuggestions: AutoReadSuggestionItem[]
}

export interface ScanStatusResponse {
  scan: ScanStatusSnapshot | null
}

function normalizeTopicKey(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160)
  return normalized || undefined
}

function isHigherPriority(
  candidate: { tier: number; confidence?: number },
  current: { tier: number; confidence?: number },
): boolean {
  if (candidate.tier !== current.tier) return candidate.tier < current.tier
  return (candidate.confidence ?? 0) > (current.confidence ?? 0)
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function parseAgeThresholdDays(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 365 ? parsed : 14
}

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fetcher: ScanFetcherService,
    private readonly classifier: ScanClassifierService,
    private readonly users: UsersService,
    private readonly timeSaved: TimeSavedService,
    private readonly knowledgeIngestion: KnowledgeIngestionService,
    private readonly knowledge: KnowledgeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Run a full scan and yield SSE events.
   * The generator completes when the scan is done (or on error).
   */
  async *runScan(userId: string, language?: string): AsyncGenerator<ScanEvent> {
    // Create ScanRun record
    const scanRun = await this.prisma.scanRun.create({
      data: { userId, status: ScanStatus.RUNNING },
    })

    this.audit.log('scan.started', { userId, metadata: { scanRunId: scanRun.id } })
    this.logger.log(`Scan started: scanRunId=${scanRun.id} user=${userId}`)

    await this.updateProgress(scanRun.id, 'fetch', 'Fetching data from all connected sources…')
    yield progress('fetch', 'Fetching data from all connected sources…')

    let sourceData: Awaited<ReturnType<ScanFetcherService['fetchAll']>>
    try {
      sourceData = await this.fetcher.fetchAll(userId)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const errorMessage = `Scan fetch failed: ${message}`
      yield error(errorMessage)
      await this.markFailed(scanRun.id, errorMessage)
      return
    }

    // Ingest raw observations into knowledge graph (fire-and-forget, never blocks scan)
    void this.knowledgeIngestion.ingestScanData(userId, scanRun.id, sourceData)

    // Emit per-source log events
    const gmailCount = sourceData.gmail.emails.length
    const slackTotal = sourceData.slack.result.channels.reduce(
      (s, c) => s + c.messages.length,
      0,
    )
    const calendarCount = sourceData.calendar.result.events.length

    // Jira / Clockify: sum today's seconds → report as hours (1 "item" = 1 entry logged today)
    const todayDay = new Date().getDate()
    const jiraSecsToday = sourceData.jiraToday.result?.secondsPerDay[todayDay] ?? 0
    const clockifySecsToday = sourceData.clockify.result?.secondsPerDay[todayDay] ?? 0
    const jiraHours = (jiraSecsToday / 3600).toFixed(1)
    const clockifyHours = (clockifySecsToday / 3600).toFixed(1)

    // Build per-item detail lines for each source
    const gmailDetail = sourceData.gmail.emails.map(
      (e) => `• [${e.subject ?? '(no subject)'}] ${e.from}`,
    )

    const slackDetail = sourceData.slack.result.channels.map((ch) => {
      const isDm = (ch as any).isDm as boolean | undefined
      const label = isDm ? `DM (${ch.channelId})` : `#${ch.channelName}`
      const suffix = isDm ? '  ← UNREAD DM' : ''
      return `• ${label} — ${ch.messages.length} msgs${suffix}`
    })

    const calendarDetail = sourceData.calendar.result.events.map((e) => {
      const time = e.start ? new Date(e.start).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '?'
      const attendeeCount = e.attendees?.length ?? 0
      const attendeeStr = attendeeCount > 0 ? ` (${attendeeCount} attendees)` : ''
      return `• ${time} ${e.summary ?? '(no title)'}${attendeeStr}`
    })

    yield logDetail('gmail', gmailCount, gmailDetail, sourceData.gmail.error)
    yield logDetail('slack', slackTotal, slackDetail, sourceData.slack.error)
    yield logDetail('calendar', calendarCount, calendarDetail, sourceData.calendar.error)
    yield logHours('jira', jiraHours, sourceData.jiraToday.error)
    yield logHours('clockify', clockifyHours, sourceData.clockify.error)

    await this.updateProgress(scanRun.id, 'classify', 'Classifying items with AI…')
    yield progress('classify', 'Classifying items with AI…')

    const [knownClients, knownProjects, kgContext, pendingProposals] = await Promise.all([
      this.prisma.client.findMany({ where: { userId }, select: { id: true, name: true } }),
      this.prisma.project.findMany({ where: { userId }, select: { id: true, name: true } }),
      this.knowledge.getClassifierContext(userId).catch(() => null),
      this.prisma.proposal.findMany({
        where: { userId, status: ProposalStatus.PENDING },
        select: {
          id: true,
          system: true,
          kind: true,
          summary: true,
          detail: true,
          tier: true,
          topicKey: true,
          externalId: true,
          sourceMessageIds: true,
        },
      }),
    ])

    const answeredSlackExternalIds = new Set(
      (sourceData.slack.result.answeredMessages ?? []).map(
        (message) => `${message.channelId}:${message.ts}`,
      ),
    )
    const expiredProposalIds = pendingProposals
      .filter(
        (proposal) => proposal.system === 'slack'
          && proposal.externalId !== null
          && answeredSlackExternalIds.has(proposal.externalId),
      )
      .map((proposal) => proposal.id)

    if (expiredProposalIds.length > 0) {
      const expired = await this.prisma.proposal.updateMany({
        where: {
          id: { in: expiredProposalIds },
          userId,
          status: ProposalStatus.PENDING,
        },
        data: { status: ProposalStatus.EXPIRED },
      })
      this.audit.log('proposal.expired', {
        userId,
        metadata: {
          scanRunId: scanRun.id,
          proposalIds: expiredProposalIds,
          expiredCount: expired.count,
          reason: 'slack_message_answered',
        },
      })
    }

    const activePendingProposals = pendingProposals.filter(
      (proposal) => !expiredProposalIds.includes(proposal.id),
    )

    let classification: Awaited<ReturnType<ScanClassifierService['classify']>>
    try {
      classification = await this.classifier.classify(sourceData, userId, language, {
        clients: knownClients,
        projects: knownProjects,
        kg: kgContext ?? undefined,
        pendingProposals: activePendingProposals,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const errorMessage = `AI classification failed: ${message}`
      yield error(errorMessage)
      await this.markFailed(scanRun.id, errorMessage)
      return
    }

    this.logger.log(
      `Classification done: ${classification.totalItems} items, ` +
        `Tier1=${classification.tierCounts[1] ?? 0} Tier2=${classification.tierCounts[2] ?? 0}`,
    )

    await this.updateProgress(scanRun.id, 'save', 'Saving proposals…')
    yield progress('save', 'Saving proposals…')

    // Persist Tier 1-2 items as Proposals
    const ageThresholdDays = parseAgeThresholdDays(
      this.config.get<string>('SCAN_MESSAGE_AGE_THRESHOLD_DAYS'),
    )
    const relevanceOptions = {
      now: new Date(),
      ageThresholdDays,
      clientIds: new Set(knownClients.map((client) => client.id)),
    }
    const classifiedActionableItems = classification.items.filter((item) => item.tier <= 2)
    const actionableItems = classifiedActionableItems.filter((item) =>
      evaluateProposalRelevance(item, sourceData, relevanceOptions).allowed,
    )
    const relevanceFilteredCount = classifiedActionableItems.length - actionableItems.length
    const pendingById = new Map(activePendingProposals.map((proposal) => [proposal.id, proposal]))
    const pendingByTopic = new Map(
      activePendingProposals
        .map((proposal) => [normalizeTopicKey(proposal.topicKey), proposal] as const)
        .filter((entry): entry is [string, (typeof activePendingProposals)[number]] => Boolean(entry[0])),
    )
    const pendingTopicKeys = new Set(
      activePendingProposals
        .map((proposal) => normalizeTopicKey(proposal.topicKey))
        .filter((topicKey): topicKey is string => topicKey !== undefined),
    )
    const uniqueItems = new Map<string, (typeof actionableItems)[number]>()
    const itemsWithoutTopic: typeof actionableItems = []
    let deduplicatedCount = 0

    for (const item of actionableItems) {
      const topicKey = normalizeTopicKey(item.topicKey)
      const matchedPending = item.existingProposalId
        ? pendingById.get(item.existingProposalId)
        : topicKey ? pendingByTopic.get(topicKey) : undefined
      if (matchedPending && item.kind === 'DOCUMENT_REVIEW' && matchedPending.kind === 'DOCUMENT_REVIEW') {
        const sourceMessageIds = [...new Set([
          ...matchedPending.sourceMessageIds,
          ...(item.sourceMessageIds ?? []),
        ])]
        await this.prisma.proposal.update({
          where: { id: matchedPending.id },
          data: {
            tier: Math.min(matchedPending.tier, item.tier),
            summary: item.summary,
            detail: item.detail,
            url: item.url ?? undefined,
            sourceMessageIds,
          },
        })
        this.audit.log('proposal.document_review_updated', {
          userId,
          metadata: { proposalId: matchedPending.id, sourceMessageCount: sourceMessageIds.length },
        })
        deduplicatedCount += 1
        continue
      }
      if (matchedPending || (topicKey && pendingTopicKeys.has(topicKey))) {
        deduplicatedCount += 1
        continue
      }
      if (!topicKey) {
        itemsWithoutTopic.push(item)
        continue
      }

      const existing = uniqueItems.get(topicKey)
      if (!existing) {
        uniqueItems.set(topicKey, { ...item, topicKey })
        continue
      }
      deduplicatedCount += 1
      if (isHigherPriority(item, existing)) {
        uniqueItems.set(topicKey, { ...item, topicKey })
      }
    }

    const proposalsToSave = [...uniqueItems.values(), ...itemsWithoutTopic]
    const savedProposals: string[] = []

    // Pre-fetch projects by jiraProjectKey to avoid N+1 queries inside the loop
    const allProjects = await this.prisma.project.findMany({
      where: { userId },
      select: { id: true, jiraProjectKey: true },
    })
    const projectByKey = new Map(
      allProjects
        .filter((p) => p.jiraProjectKey)
        .map((p) => [p.jiraProjectKey!, p.id]),
    )

    for (const item of proposalsToSave) {
      try {
        let resolvedExternalId = item.externalId
        let originalMessage: string | undefined = undefined
        let sourceOccurredAt: Date | undefined = undefined

        if (item.system === 'gmail' && item.externalId) {
          const email = sourceData.gmail.emails.find((e) => e.messageId === item.externalId)
          if (email) {
            const receivedAt = new Date(email.receivedAt)
            if (!Number.isNaN(receivedAt.getTime())) {
              sourceOccurredAt = receivedAt
            }
            const toLine = email.to ? `To: ${email.to}\n` : ''
            const ccLine = email.cc ? `CC: ${email.cc}\n` : ''
            originalMessage = `From: ${email.from}\n${toLine}${ccLine}Subject: ${email.subject}\nDate: ${email.receivedAt}\n---\n${email.body || email.snippet}`
          }
        } else if (item.system === 'slack' && item.externalId) {
          // Single pass: resolve both resolvedExternalId and originalMessage together
          for (const ch of sourceData.slack.result.channels) {
            const msg = ch.messages.find((m) => m.ts === item.externalId)
            if (msg) {
              resolvedExternalId = `${ch.channelId}:${item.externalId}`
              const slackDate = new Date(parseFloat(msg.ts) * 1000)
              if (!Number.isNaN(slackDate.getTime())) {
                sourceOccurredAt = slackDate
              }
              const dateLine = sourceOccurredAt ? `Date: ${sourceOccurredAt.toISOString()}\n` : ''
              originalMessage = `Channel: #${ch.channelName}\nChannelId: ${ch.channelId}\nAuthor: @${msg.userName || msg.userId}\n${dateLine}---\n${msg.text}`
              break
            }
          }
        }

        const proposal = await this.prisma.proposal.create({
          data: {
            scanRunId: scanRun.id,
            userId,
            system: item.system,
            kind: item.kind ?? 'MESSAGE_REPLY',
            tier: item.tier,
            summary: item.summary,
            detail: item.detail,
            draft: item.draft ?? null,
            url: item.url ?? null,
            externalId: resolvedExternalId ?? null,
            sourceMessageIds: item.sourceMessageIds ?? [],
            status: ProposalStatus.PENDING,
            confidence: item.confidence ?? null,
            risk: item.risk ?? null,
            issueKey: item.issueKey ?? null,
            originalMessage: originalMessage ?? null,
            sourceOccurredAt: sourceOccurredAt ?? null,
            topicKey: normalizeTopicKey(item.topicKey) ?? null,
            projectId: item.projectKey
              ? (projectByKey.get(item.projectKey) ?? item.detectedProjectId ?? null)
              : item.detectedProjectId ?? null,
          },
        })

        savedProposals.push(proposal.id)

        const proposalEvent: ScanProposalEvent = {
          type: 'proposal',
          proposal: {
            id: proposal.id,
            system: proposal.system,
            kind: proposal.kind,
            tier: proposal.tier,
            summary: proposal.summary,
            detail: proposal.detail ?? undefined,
            draft: proposal.draft ?? undefined,
            url: proposal.url ?? undefined,
            externalId: proposal.externalId ?? undefined,
            sourceMessageIds: proposal.sourceMessageIds,
            confidence: proposal.confidence ?? undefined,
            risk: proposal.risk ?? undefined,
            originalMessage,
            sourceOccurredAt: sourceOccurredAt?.toISOString(),
            issueKey: item.issueKey,
            projectKey: item.projectKey,
            detectedClient: item.detectedClient,
            detectedClientId: item.detectedClientId,
            calendarEventId: item.calendarEventId,
          },
        }
        yield proposalEvent
      } catch (err: unknown) {
        if (isUniqueConstraintError(err)) {
          deduplicatedCount += 1
          this.logger.debug(`Skipped concurrently duplicated proposal for item=${item.id}`)
          continue
        }
        this.logger.error(
          `Failed to save proposal for item=${item.id}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // Collect Tier 3-5 Gmail items as auto-read suggestions
    const autoReadItems = classification.items
      .filter((i) => i.tier >= 3 && i.system === 'gmail' && i.externalId)
      .map((i) => {
        const email = sourceData.gmail.emails.find((e) => e.messageId === i.externalId)
        if (!email) return null
        if (
          !email.googleDocsComment
          && isPotentialGoogleDocsCommentNotification(email)
        ) return null
        return {
          messageId: email.messageId,
          subject: email.subject,
          from: email.from,
          receivedAt: email.receivedAt,
        }
      })
      .filter((x): x is AutoReadSuggestionItem => x !== null)

    if (autoReadItems.length > 0) {
      const autoReadEvent: ScanAutoReadSuggestionsEvent = {
        type: 'auto_read_suggestions',
        items: autoReadItems,
      }
      yield autoReadEvent
    }

    // Update ScanRun to COMPLETED
    const sourceCounts: Record<string, number> = {
      gmail: gmailCount,
      slack: slackTotal,
      calendar: calendarCount,
      jiraSecsToday,
      clockifySecsToday,
    }

    await this.prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        status: ScanStatus.COMPLETED,
        phase: 'done',
        message: 'Scan completed.',
        completedAt: new Date(),
        metadata: {
          tierCounts: classification.tierCounts,
          totalItems: classification.totalItems,
          proposalCount: savedProposals.length,
          deduplicatedCount,
          relevanceFilteredCount,
          autoReadSuggestions: autoReadItems.map((item) => ({
            messageId: item.messageId,
            subject: item.subject,
            from: item.from,
            receivedAt: item.receivedAt,
          })),
          sources: sourceCounts,
        },
      },
    })

    // Increment user's scans counter (best-effort)
    try {
      await this.users.incrementScans(userId)
    } catch (err) {
      this.logger.warn(`Failed to increment scansCount for user=${userId}: ${err instanceof Error ? err.message : String(err)}`)
    }
    void this.timeSaved.record(userId, 'scan')

    this.audit.log('scan.completed', {
      userId,
      metadata: {
        scanRunId: scanRun.id,
        totalItems: classification.totalItems,
        proposalCount: savedProposals.length,
        deduplicatedCount,
        relevanceFilteredCount,
      },
    })

    const completedEvent: ScanCompletedEvent = {
      type: 'completed',
      scanRunId: scanRun.id,
      summary: {
        tierCounts: classification.tierCounts,
        totalItems: classification.totalItems,
        proposalCount: savedProposals.length,
        sources: sourceCounts,
      },
    }
    yield completedEvent
  }

  async getLatestScanStatus(userId: string): Promise<ScanStatusResponse> {
    const scanRun = await this.prisma.scanRun.findFirst({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: { proposals: { orderBy: { createdAt: 'asc' } } },
    })

    if (!scanRun) {
      return { scan: null }
    }

    const snapshot: ScanStatusSnapshot = {
      scanRunId: scanRun.id,
      status: scanRun.status,
      phase: normalizePhase(scanRun.phase, scanRun.status),
      message: scanRun.message,
      startedAt: scanRun.startedAt.toISOString(),
      completedAt: scanRun.completedAt?.toISOString() ?? null,
      summary: summaryFromMetadata(scanRun.metadata),
      autoReadSuggestions: autoReadSuggestionsFromMetadata(scanRun.metadata),
      proposals: scanRun.proposals.map((proposal) => ({
        id: proposal.id,
        system: proposal.system,
        kind: proposal.kind,
        tier: proposal.tier,
        summary: proposal.summary,
        detail: proposal.detail ?? undefined,
        draft: proposal.draft ?? undefined,
        url: proposal.url ?? undefined,
        externalId: proposal.externalId ?? undefined,
        sourceMessageIds: proposal.sourceMessageIds,
        status: proposal.status,
        confidence: proposal.confidence ?? undefined,
        risk: proposal.risk ?? undefined,
        originalMessage: proposal.originalMessage ?? undefined,
        sourceOccurredAt: proposal.sourceOccurredAt?.toISOString(),
        issueKey: proposal.issueKey ?? undefined,
      })),
    }

    return { scan: snapshot }
  }

  private async updateProgress(scanRunId: string, phase: ScanPhase, message: string): Promise<void> {
    await this.prisma.scanRun.update({
      where: { id: scanRunId },
      data: { phase, message },
    })
  }

  private async markFailed(scanRunId: string, message: string): Promise<void> {
    try {
      await this.prisma.scanRun.update({
        where: { id: scanRunId },
        data: {
          status: ScanStatus.FAILED,
          phase: 'error',
          message,
          completedAt: new Date(),
        },
      })
    } catch {
      // best-effort
    }
  }
}

// ─── Event builders ───────────────────────────────────────────────────────────

function progress(phase: ScanPhase, message: string): ScanProgressEvent {
  return { type: 'progress', phase, message }
}

function logDetail(source: string, count: number, detail: string[], errorMsg?: string): ScanLogEvent {
  return {
    type: 'log',
    source,
    count,
    message: errorMsg ? `${source}: error – ${errorMsg}` : `${source}: ${count} items`,
    detail,
  }
}

function logHours(source: string, hours: string, errorMsg?: string): ScanLogEvent {
  return {
    type: 'log',
    source,
    count: 0,
    message: errorMsg ? `${source}: error – ${errorMsg}` : `${source}: ${hours}h today`,
  }
}

function error(message: string): ScanErrorEvent {
  return { type: 'error', message }
}

function normalizePhase(phase: string, status: ScanStatus): ScanPhase {
  if (phase === 'fetch' || phase === 'classify' || phase === 'save' || phase === 'done' || phase === 'error') {
    return phase
  }
  if (status === ScanStatus.COMPLETED) return 'done'
  if (status === ScanStatus.FAILED) return 'error'
  return 'fetch'
}

function summaryFromMetadata(metadata: unknown): ScanSummary | null {
  if (!isRecord(metadata)) return null
  const { tierCounts, totalItems, proposalCount, sources } = metadata
  if (
    !isRecord(tierCounts) ||
    typeof totalItems !== 'number' ||
    typeof proposalCount !== 'number' ||
    !isRecord(sources)
  ) {
    return null
  }

  const parsedTierCounts: Record<number, number> = {}
  for (const [key, value] of Object.entries(tierCounts)) {
    const tier = Number(key)
    if (!Number.isInteger(tier) || typeof value !== 'number') return null
    parsedTierCounts[tier] = value
  }

  const parsedSources: Record<string, number> = {}
  for (const [key, value] of Object.entries(sources)) {
    if (typeof value !== 'number') return null
    parsedSources[key] = value
  }

  return { tierCounts: parsedTierCounts, totalItems, proposalCount, sources: parsedSources }
}

function autoReadSuggestionsFromMetadata(metadata: unknown): AutoReadSuggestionItem[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.autoReadSuggestions)) return []
  return metadata.autoReadSuggestions.filter((item): item is AutoReadSuggestionItem =>
    isRecord(item) &&
    typeof item.messageId === 'string' &&
    typeof item.subject === 'string' &&
    typeof item.from === 'string' &&
    typeof item.receivedAt === 'string',
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
