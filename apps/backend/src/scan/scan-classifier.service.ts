/**
 * ScanClassifierService
 *
 * Uses the AI Gateway to classify scan data into tiers and generate proposal drafts.
 *
 * Tier definitions (from old houston.md command):
 *  1 – Action Required: DMs, @mentions, TO emails with questions, requests
 *  2 – Important Updates: external client messages, shared docs by key people
 *  3 – FYI / Team Activity: channel activity, CC'd emails, internal shares
 *  4 – Newsletters: newsletter@, digest@, marketing patterns
 *  5 – Automated / Noise: GitHub, CI/CD, calendar auto-replies, notifications@
 *
 * Autonomy: Level 1 (suggestions only). No auto-execution.
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import type { ScanSourceData } from './scan-fetcher.service'

export interface ClassifiedItem {
  id: string
  system: 'gmail' | 'slack' | 'jira' | 'calendar' | 'clockify'
  tier: number
  summary: string
  detail: string
  draft?: string
  url?: string
  externalId?: string
  confidence?: number
  risk?: string
  issueKey?: string
  projectKey?: string
  detectedClient?: string
  detectedClientId?: string
  detectedProjectId?: string
  calendarEventId?: string
  topicKey?: string
  existingProposalId?: string
  kind?: 'MESSAGE_REPLY' | 'DOCUMENT_REVIEW'
  sourceMessageIds?: string[]
}

export interface PendingProposalContext {
  id: string
  system: string
  summary: string
  detail?: string | null
  topicKey?: string | null
}

export interface ClassificationResult {
  items: ClassifiedItem[]
  tierCounts: Record<number, number>
  totalItems: number
}

@Injectable()
export class ScanClassifierService {
  private readonly logger = new Logger(ScanClassifierService.name)
  private readonly slackMaxPromptMessages: number

  constructor(
    private readonly ai: AiGatewayService,
    private readonly config: ConfigService,
  ) {
    this.slackMaxPromptMessages = parseInt(
      this.config.get<string>('SLACK_MAX_PROMPT_MESSAGES') ?? '50',
      10,
    )
  }

  async classify(
    data: ScanSourceData,
    userId: string,
    language?: string,
    context?: {
      clients: { id: string; name: string }[]
      projects: { id: string; name: string }[]
      pendingProposals?: PendingProposalContext[]
      kg?: {
        contacts: { name: string; email?: string; organization?: string }[]
        tasks: { issueKey: string; summary: string; status?: string }[]
        recentOutcomes: { title: string; proposalStatus: string; tier: number }[]
      }
    },
  ): Promise<ClassificationResult> {
    this.logger.debug(`Classifying scan data for user=${userId}, language=${language}`)

    const prompt = this.buildPrompt(data)

    // Dynamicky uprav system prompt podle jazyka
    let systemPrompt = SYSTEM_PROMPT
    if (context?.clients?.length || context?.projects?.length) {
      systemPrompt += buildContextSection(context)
    }
    if (context?.kg) {
      systemPrompt += buildKgSection(context.kg)
    }
    if (context?.pendingProposals?.length) {
      systemPrompt += buildPendingProposalSection(context.pendingProposals)
    }
    if (language === 'cs') {
      systemPrompt += '\n\nAll output, including draft replies, must be in Czech.'
    } else if (language === 'en') {
      systemPrompt += '\n\nAll output, including draft replies, must be in English.'
    }

    let raw: string
    try {
      raw = await this.ai.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        { jsonMode: true, temperature: 0.1, userId },
      )
    } catch (err: unknown) {
      this.logger.error(`AI classification failed for user=${userId}: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    }

    return applyGoogleDocsPolicy(this.parseResponse(raw), data)
  }

  // ─── Prompt building ─────────────────────────────────────────────────────

  private buildPrompt(data: ScanSourceData): string {
    const parts: string[] = []

    // Gmail
    const regularEmails = data.gmail.emails.filter((email) => !email.googleDocsComment)
    const docsEmails = data.gmail.emails.filter((email) => email.googleDocsComment)
    if (regularEmails.length > 0) {
      parts.push('## Gmail – Unread emails')
      for (const e of regularEmails) {
        const resolution = e.resolution ? ` | resolution:${e.resolution}` : ''
        const threadContext = e.threadContext ? `\n  later thread context: ${e.threadContext}` : ''
        parts.push(
          `- id:${e.messageId} | from:${e.from} | to:${e.to} | cc:${e.cc} | recipientRole:${e.recipientRole} | subject:${e.subject} | received:${e.receivedAt}${resolution}\n  body: ${(e.body || e.snippet).slice(0, 2000)}${threadContext}`,
        )
      }
    } else if (data.gmail.error && docsEmails.length === 0) {
      parts.push(`## Gmail – ERROR: ${data.gmail.error}`)
    } else if (docsEmails.length === 0) {
      parts.push('## Gmail – No unread emails')
    }

    if (docsEmails.length > 0) {
      parts.push('\n## Google Docs comment notifications')
      for (const email of docsEmails) {
        const comment = email.googleDocsComment!
        parts.push(
          `- id:${email.messageId} | documentId:${comment.documentId} | title:${comment.documentTitle} | mentions:${comment.mentionedEmails.join(',') || 'none'} | mentionsCurrentUser:${String(comment.mentionsCurrentUser)} | repliesToCurrentUser:${comment.repliesToCurrentUser} | received:${email.receivedAt}\n  comment: ${comment.commentText}`,
        )
      }
      parts.push('Classify every notification separately. For comments without mentions, decide whether the task or question is directed to the current user. Do not treat a mention of another user as addressing the current user.')
    }

    // Slack – include messages up to a safe cap to avoid huge prompts
    const slackChannels = data.slack.result.channels
    if (slackChannels.length > 0) {
      const cap = this.slackMaxPromptMessages
      let remaining = Number.isFinite(cap) && cap > 0 ? cap : 100
      let omitted = 0

      // Prioritize: DMs and channels containing mentions (<@...) first, then others
      const priority: typeof slackChannels = []
      const others: typeof slackChannels = []
      for (const ch of slackChannels) {
        const hasMention = ch.messages.some((m) => typeof m.text === 'string' && m.text.includes('<@'))
        if (ch.conversationType === 'dm' || hasMention) priority.push(ch)
        else others.push(ch)
      }

      parts.push('\n## Slack – Unread messages')

      for (const ch of [...priority, ...others]) {
        if (remaining <= 0) {
          omitted += ch.messages.length
          continue
        }
        parts.push(`### Channel: ${ch.channelName} (${ch.channelId}) | type:${ch.conversationType ?? 'unknown'}`)
        for (const m of ch.messages) {
          if (remaining <= 0) {
            omitted += 1
            continue
          }
          parts.push(`- ts:${m.ts} user:${m.userId} | mentionsCurrentUser:${m.mentionsCurrentUser === true} | ${m.text.slice(0, 200)}`)
          remaining -= 1
        }
      }

      if (omitted > 0) {
        parts.push(`\n(Note: ${omitted} additional Slack messages omitted from the prompt to limit token usage)`)
      }
    } else if (data.slack.error) {
      parts.push(`\n## Slack – ERROR: ${data.slack.error}`)
    } else {
      parts.push('\n## Slack – No unread messages')
    }

    // Calendar
    const events = data.calendar.result.events
    if (events.length > 0) {
      parts.push('\n## Calendar – Upcoming events')
      for (const e of events) {
        const attendees = e.attendees.map((a) => a.email).join(', ')
        parts.push(`- ${e.start} → ${e.end} | ${e.summary} | attendees: ${attendees}`)
      }
    } else if (data.calendar.error) {
      parts.push(`\n## Calendar – ERROR: ${data.calendar.error}`)
    } else {
      parts.push('\n## Calendar – No upcoming events')
    }

    // Jira worklogs today
    if (data.jiraToday.result) {
      const today = new Date().getDate()
      const todaySecs = data.jiraToday.result.secondsPerDay[today] ?? 0
      const hrs = (todaySecs / 3600).toFixed(1)
      parts.push(`\n## Jira – Today's worklogs: ${hrs}h`)
    } else if (data.jiraToday.error) {
      parts.push(`\n## Jira – ERROR: ${data.jiraToday.error}`)
    }

    // Clockify
    if (data.clockify.result) {
      const today = new Date().getDate()
      const todaySecs = data.clockify.result.secondsPerDay[today] ?? 0
      const hrs = (todaySecs / 3600).toFixed(1)
      parts.push(`\n## Clockify – Today's time: ${hrs}h`)
    }

    return parts.join('\n')
  }

  // ─── Response parsing ─────────────────────────────────────────────────────

  private parseResponse(raw: string): ClassificationResult {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.logger.error('AI returned invalid JSON, treating as empty classification')
      return { items: [], tierCounts: {}, totalItems: 0 }
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Record<string, unknown>)['items'])) {
      this.logger.error('AI response missing "items" array')
      return { items: [], tierCounts: {}, totalItems: 0 }
    }

    const rawItems = (parsed as { items: unknown[] }).items
    const items: ClassifiedItem[] = []
    const tierCounts: Record<number, number> = {}

    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>

      const tier = typeof item['tier'] === 'number' ? item['tier'] : parseInt(String(item['tier'] ?? '5'), 10)
      if (isNaN(tier) || tier < 1 || tier > 5) continue

      items.push({
        id: String(item['id'] ?? `item-${Date.now()}-${Math.random()}`),
        system: validateSystem(String(item['system'] ?? 'gmail')),
        tier,
        summary: String(item['summary'] ?? ''),
        detail: String(item['detail'] ?? ''),
        draft: item['draft'] ? String(item['draft']) : undefined,
        url: item['url'] ? String(item['url']) : undefined,
        externalId: item['externalId'] ? String(item['externalId']) : undefined,
        confidence: typeof item['confidence'] === 'number' ? item['confidence'] : undefined,
        risk: item['risk'] ? String(item['risk']) : undefined,
        issueKey: item['issueKey'] ? String(item['issueKey']) : undefined,
        projectKey: item['projectKey'] ? String(item['projectKey']) : undefined,
        detectedClient: item['detectedClient'] ? String(item['detectedClient']) : undefined,
        detectedClientId: item['detectedClientId'] ? String(item['detectedClientId']) : undefined,
        detectedProjectId: item['detectedProjectId'] ? String(item['detectedProjectId']) : undefined,
        calendarEventId: item['calendarEventId'] ? String(item['calendarEventId']) : undefined,
        topicKey: parseOptionalString(item['topicKey'], 160),
        existingProposalId: parseOptionalString(item['existingProposalId'], 100),
        kind: item['kind'] === 'DOCUMENT_REVIEW' ? 'DOCUMENT_REVIEW' : 'MESSAGE_REPLY',
        sourceMessageIds: parseStringArray(item['sourceMessageIds'], 50),
      })

      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
    }

    return { items, tierCounts, totalItems: items.length }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildContextSection(context: { clients: { id: string; name: string }[]; projects: { id: string; name: string }[] }): string {
  const lines: string[] = ['\n\n## Known entities – match against these when detecting clients and projects']
  if (context.clients.length > 0) {
    lines.push('\n### Known clients')
    for (const c of context.clients) {
      lines.push(`- "${c.name}" (id: ${c.id})`)
    }
    lines.push('When the message is clearly from or about one of these clients, set detectedClientId to their id and detectedClient to their exact name.')
  }
  if (context.projects.length > 0) {
    lines.push('\n### Known projects')
    for (const p of context.projects) {
      lines.push(`- "${p.name}" (id: ${p.id})`)
    }
    lines.push('When the message clearly relates to one of these projects, set detectedProjectId to their id.')
  }
  return lines.join('\n')
}

function buildKgSection(kg: {
  contacts: { name: string; email?: string; organization?: string }[]
  tasks: { issueKey: string; summary: string; status?: string }[]
  recentOutcomes: { title: string; proposalStatus: string; tier: number }[]
}): string {
  const lines: string[] = ['\n\n## Knowledge Graph – accumulated context']

  if (kg.contacts.length > 0) {
    lines.push('\n### Known contacts (from previous interactions)')
    for (const c of kg.contacts) {
      const parts = [c.name]
      if (c.email) parts.push(c.email)
      if (c.organization) parts.push(`org: ${c.organization}`)
      lines.push(`- ${parts.join(' | ')}`)
    }
    lines.push('Use these to identify whether a sender is a known external client contact or internal team member.')
  }

  if (kg.tasks.length > 0) {
    lines.push('\n### Active tasks / Jira issues')
    for (const t of kg.tasks) {
      lines.push(`- ${t.issueKey}: "${t.summary}"${t.status ? ` [${t.status}]` : ''}`)
    }
    lines.push('When a message mentions one of these issue keys, use it for issueKey and derive projectKey from the prefix.')
  }

  if (kg.recentOutcomes.length > 0) {
    lines.push('\n### Recent conversation outcomes (last 20)')
    for (const o of kg.recentOutcomes) {
      lines.push(`- "${o.title}" → ${o.proposalStatus} (was tier ${o.tier})`)
    }
    lines.push('Use these patterns to calibrate tier assignments for similar messages.')
  }

  return lines.join('\n')
}

function validateSystem(s: string): ClassifiedItem['system'] {
  const allowed: ClassifiedItem['system'][] = ['gmail', 'slack', 'jira', 'calendar', 'clockify']
  return allowed.includes(s as ClassifiedItem['system']) ? (s as ClassifiedItem['system']) : 'gmail'
}

function parseOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) return undefined
  return normalized
}

function parseStringArray(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
  return result.length > 0 ? result : undefined
}

function applyGoogleDocsPolicy(
  result: ClassificationResult,
  data: ScanSourceData,
): ClassificationResult {
  const docsEmails = data.gmail.emails.filter((email) => email.googleDocsComment)
  if (docsEmails.length === 0) return result

  const docsIds = new Set(docsEmails.map((email) => email.messageId))
  const modelBySourceId = new Map<string, ClassifiedItem>()
  for (const item of result.items) {
    const sourceId = item.externalId ?? item.id.replace(/^gmail-/, '')
    if (docsIds.has(sourceId)) modelBySourceId.set(sourceId, item)
  }

  const retainedItems = result.items.filter((item) => {
    const sourceId = item.externalId ?? item.id.replace(/^gmail-/, '')
    return !docsIds.has(sourceId)
  })
  const relevantByDocument = new Map<string, typeof docsEmails>()

  for (const email of docsEmails) {
    const comment = email.googleDocsComment!
    const modelItem = modelBySourceId.get(email.messageId)
    const hasMentions = comment.mentionedEmails.length > 0
    const relevant = comment.mentionsCurrentUser === true
      || comment.repliesToCurrentUser
      || (comment.mentionsCurrentUser === null && hasMentions)
      || (!hasMentions && (modelItem?.tier ?? 5) <= 2)

    if (relevant) {
      const group = relevantByDocument.get(comment.documentId) ?? []
      group.push(email)
      relevantByDocument.set(comment.documentId, group)
      continue
    }

    retainedItems.push({
      ...(modelItem ?? {
        id: `gmail-${email.messageId}`,
        system: 'gmail' as const,
        summary: `Komentář v dokumentu ${comment.documentTitle}`,
        detail: comment.commentText,
      }),
      tier: Math.max(3, modelItem?.tier ?? 3),
      externalId: email.messageId,
      kind: 'MESSAGE_REPLY',
      sourceMessageIds: undefined,
    })
  }

  for (const [documentId, emails] of relevantByDocument) {
    emails.sort((left, right) => {
      const priority = (email: (typeof emails)[number]) =>
        email.googleDocsComment!.mentionsCurrentUser === true ? 0
          : email.googleDocsComment!.repliesToCurrentUser ? 1 : 2
      return priority(left) - priority(right)
        || Date.parse(right.receivedAt) - Date.parse(left.receivedAt)
    })
    const first = emails[0].googleDocsComment!
    const tier = emails.some((email) =>
      email.googleDocsComment!.mentionsCurrentUser === true
      || email.googleDocsComment!.repliesToCurrentUser,
    ) ? 1 : 2
    retainedItems.push({
      id: `google-docs-${documentId}`,
      system: 'gmail',
      tier,
      summary: `Reagovat na komentáře v dokumentu ${first.documentTitle}`,
      detail: emails.map((email, index) =>
        `${index + 1}. ${email.googleDocsComment!.commentText}`,
      ).join('\n\n'),
      url: first.documentUrl
        ?? `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(emails[0].messageId)}`,
      externalId: emails[0].messageId,
      confidence: 1,
      risk: 'low',
      topicKey: `google-doc-${documentId}-review-comments`,
      kind: 'DOCUMENT_REVIEW',
      sourceMessageIds: emails.map((email) => email.messageId),
    })
  }

  const tierCounts: Record<number, number> = {}
  for (const item of retainedItems) tierCounts[item.tier] = (tierCounts[item.tier] ?? 0) + 1
  return { items: retainedItems, tierCounts, totalItems: retainedItems.length }
}

function buildPendingProposalSection(proposals: PendingProposalContext[]): string {
  const lines = ['\n\n## Existing pending proposals']
  for (const proposal of proposals) {
    const topic = proposal.topicKey ? ` | topicKey: ${proposal.topicKey}` : ''
    const detail = proposal.detail ? ` | detail: ${proposal.detail.slice(0, 300)}` : ''
    lines.push(`- id: ${proposal.id} | system: ${proposal.system}${topic} | summary: ${proposal.summary}${detail}`)
  }
  lines.push('If an incoming item has the same conversational topic and requested outcome as one of these pending proposals, reuse its topicKey when present and set existingProposalId to its id.')
  return lines.join('\n')
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Houston – an AI executive assistant. Your task is to classify incoming items
from multiple sources and generate actionable proposals. Respond ONLY with valid JSON.

## Tier definitions
- Tier 1 – Action Required: Direct messages, @mentions, emails addressed TO the user with questions or requests, permission/licence requests
- Tier 2 – Important Updates: Messages from external clients, admin announcements, shared documents by key people
- Tier 3 – FYI / Team Activity: Channel activity, CC'd emails, internal updates, team notifications  
- Tier 4 – Newsletters: newsletter@, digest@, noreply@ with marketing patterns, subscription emails
- Tier 5 – Automated / Noise: GitHub, CI/CD, calendar auto-replies, notifications@, automated alerts

## Relevance rules
- A Gmail message addressed only in CC and an unmentioned Slack channel message are at most Tier 3; mentions of other Slack users do not address the current user.
- A Tier 1-2 item must be directly addressed (Gmail recipientRole:to, Slack type:dm, or Slack mentionsCurrentUser:true), unless it is a Tier 2 message clearly tied to a Known client.
- For an old message carrying resolution:answered, do not create an actionable item. When later thread context is present, treat explicit completion, cancellation, or assignment to someone else as resolved.

## Output format
Return a JSON object with an "items" array. Each item:
{
  "id": "<unique id based on source id, e.g. gmail-<messageId> or slack-<channelId>-<ts>>",
  "system": "gmail" | "slack" | "jira" | "calendar" | "clockify",
  "tier": 1-5,
  "summary": "<concise one-line summary of the action needed>",
  "detail": "<2-4 sentences: who, what, why it needs attention>",
  "draft": "<full reply draft for Tier 1-2 only, empty string otherwise>",
  "url": "<direct link to the item, empty string if not available>",
  "externalId": "<provider-side ID: Gmail messageId, Slack ts, etc.>",
  "confidence": 0.0-1.0,
  "risk": "low" | "medium" | "high" | "",
  "issueKey": "<Jira issue key if explicitly mentioned in the message, e.g. PROJ-123, empty string otherwise>",
  "projectKey": "<Jira project key/prefix if detectable from issueKey or context, e.g. PROJ, empty string otherwise>",
  "detectedClient": "<client or company name if clearly identifiable from the message content, empty string otherwise>",
  "detectedClientId": "<id from Known clients list if matched, empty string otherwise>",
  "detectedProjectId": "<id from Known projects list if matched, empty string otherwise>",
  "calendarEventId": "<Google Calendar event ID from the input data if this item directly relates to a specific calendar event, empty string otherwise>",
  "topicKey": "<stable lowercase kebab-case key for the conversational topic and requested outcome>",
  "existingProposalId": "<id from Existing pending proposals when this item is already covered, empty string otherwise>"
}

Rules:
- Include ALL items (all tiers 1–5)
- Google Docs comment notifications must be classified individually using their source id. A mention addresses the current user only when mentionsCurrentUser:true. Set Tier 3–5 for notifications that mention only other users and contain no action for the current user.
- Return at most one item for messages that concern the same conversational topic and request the same outcome or action. Combine follow-ups into the most actionable item.
- Do not merge distinct requested actions merely because they mention the same project or person.
- Build topicKey from the enduring topic plus requested outcome, not message IDs, timestamps, wording, tier, or source system.
- Never invent existingProposalId. It may only be copied from the Existing pending proposals list when that proposal already covers the same topic and requested outcome.
- For Tier 1-2, write a complete professional draft reply in Czech or English (match the original language). Do NOT include any closing signature, sign-off, or valediction — the user will add their own signature separately.
- Never invent information not present in the input
- Confidence is your certainty in the tier classification
- Risk reflects the risk of acting on this item (e.g. sending a reply)
- For detectedClientId and detectedProjectId: only use IDs from the Known clients/projects lists provided. If no match, use empty string.
`
