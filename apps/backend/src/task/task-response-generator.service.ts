import { Injectable } from '@nestjs/common'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'
import type { TaskIntent } from './task-intent-analyzer.service'
import type { TaskContext } from './task-context-builder.service'

export interface TaskProposalDraft {
  system: string
  tier: 1 | 2
  summary: string
  detail: string
  draft?: string
  issueKey?: string
  confidence: number
}

export interface TaskResponse {
  summary: string
  proposals: TaskProposalDraft[]
}

const SYSTEM_PROMPT = `You are Houston – an AI executive assistant with full context of the user's work.

Your task: answer the user's natural language request by synthesizing the provided context.

Return ONLY a JSON object:
{
  "summary": "Markdown-formatted response. Use ## headers, bullet points, bold for key info. Be specific, use data from context.",
  "proposals": [
    {
      "system": "task" | "gmail" | "slack" | "jira",
      "tier": 1 or 2,
      "summary": "short actionable title (under 80 chars)",
      "detail": "explanation of why this action is needed",
      "draft": "optional: draft text for the action (reply, comment, etc.)",
      "issueKey": "PROJ-123 only if Jira-related",
      "confidence": 0.0 to 1.0
    }
  ]
}

Rules:
- summary must directly address the user's request using evidence from the context
- proposals only when there is clear, evidence-backed need – do NOT invent actions
- if no proposals are needed, return proposals: []
- tier 1 = requires immediate action; tier 2 = important but not urgent
- never fabricate information not present in the context
- respond in the language specified`

@Injectable()
export class TaskResponseGeneratorService {
  constructor(private readonly ai: AiGatewayService) {}

  async generate(
    userId: string,
    request: string,
    intent: TaskIntent,
    context: TaskContext,
    language?: string,
  ): Promise<TaskResponse> {
    const contextSection = this.buildContextSection(context)
    const langInstruction = language === 'cs' ? 'Respond in Czech.' : 'Respond in English.'

    const userPrompt = `${langInstruction}

User request: "${request}"
Intent type: ${intent.intentType} about "${intent.topic}"

${contextSection}`

    const response = await this.ai.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      // The one call site on the 'high' tier: this is the answer the user reads,
      // synthesised over the whole context block. Everything else stays 'fast'.
      { jsonMode: true, temperature: 0.3, maxTokens: 4000, userId, quality: 'high' },
    )

    const parsed = JSON.parse(response) as TaskResponse
    return {
      summary: parsed.summary ?? '',
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
    }
  }

  private buildContextSection(context: TaskContext): string {
    const sections: string[] = []

    if (context.entities.length > 0) {
      sections.push(`## Knowledge Graph Entities (${context.entities.length} found)`)
      sections.push(
        context.entities
          .slice(0, 25)
          .map(
            (e) =>
              `- [${e.type}] ${e.title}` +
              (e.status ? ` (${e.status})` : '') +
              (e.description ? `: ${e.description.slice(0, 120)}` : ''),
          )
          .join('\n'),
      )
    }

    if (context.kgContext) {
      const { contacts, tasks, recentOutcomes } = context.kgContext
      if (contacts.length > 0) {
        sections.push(`## Known Contacts`)
        sections.push(
          contacts
            .slice(0, 15)
            .map(
              (c) =>
                `- ${c.name}` +
                (c.email ? ` <${c.email}>` : '') +
                (c.organization ? ` @ ${c.organization}` : ''),
            )
            .join('\n'),
        )
      }
      if (tasks.length > 0) {
        sections.push(`## Open Tasks`)
        sections.push(
          tasks
            .slice(0, 25)
            .map((t) => `- ${t.issueKey}: ${t.summary}` + (t.status ? ` [${t.status}]` : ''))
            .join('\n'),
        )
      }
      if (recentOutcomes.length > 0) {
        sections.push(`## Recent Proposal Outcomes`)
        sections.push(
          recentOutcomes
            .slice(0, 10)
            .map((o) => `- [T${o.tier}/${o.proposalStatus}] ${o.title}`)
            .join('\n'),
        )
      }
    }

    if (context.recentProposals.length > 0) {
      sections.push(`## Recent Proposals (${context.recentProposals.length})`)
      sections.push(
        context.recentProposals
          .map((p) => {
            let line =
              `- [T${p.tier}/${p.status}/${p.system}] ${p.summary}` +
              (p.issueKey ? ` (${p.issueKey})` : '') +
              ` — ${new Date(p.createdAt).toLocaleDateString()}`
            if (p.detail) line += `\n  Detail: ${p.detail.slice(0, 200)}`
            if (p.originalMessage) {
              // Include the original message, truncated to keep tokens manageable
              line += `\n  Zpráva:\n${p.originalMessage.slice(0, 600).split('\n').map((l) => `    ${l}`).join('\n')}`
            }
            return line
          })
          .join('\n'),
      )
    }

    if (context.cachedIssues.length > 0) {
      sections.push(`## Cached Jira Issues`)
      sections.push(
        context.cachedIssues
          .slice(0, 30)
          .map((i) => `- ${i.issueKey}: ${i.summary}`)
          .join('\n'),
      )
    }

    if (context.clients.length > 0) {
      sections.push(`## Clients`)
      sections.push(
        context.clients
          .map((c) => `- ${c.name}` + (c.domain ? ` (${c.domain})` : ''))
          .join('\n'),
      )
    }

    if (context.projects.length > 0) {
      sections.push(`## Active Projects`)
      sections.push(
        context.projects
          .map((p) => `- ${p.name}` + (p.jiraProjectKey ? ` [${p.jiraProjectKey}]` : ''))
          .join('\n'),
      )
    }

    if (context.liveData) {
      const { searchTerms, recentEmails, recentSlack, calendarEvents } = context.liveData
      const searchLabel = searchTerms?.length ? ` (search: ${searchTerms.join(', ')})` : ''

      if (recentEmails?.length) {
        sections.push(`## Live: Relevant Emails${searchLabel} (${recentEmails.length})`)
        sections.push(
          recentEmails
            .map((e) => {
              const snippet = (e.body ?? e.snippet ?? '').slice(0, 300).replace(/\n+/g, ' ')
              return `- [${e.receivedAt ? new Date(e.receivedAt).toLocaleDateString('cs-CZ') : ''}] From: ${e.from} | Subject: ${e.subject ?? '(no subject)'}\n  ${snippet}`
            })
            .join('\n'),
        )
      }

      if (recentSlack?.length) {
        sections.push(`## Live: Relevant Slack Messages${searchLabel} (${recentSlack.length})`)
        sections.push(
          recentSlack
            .map((m) => {
              const channel = m.channelName ? `#${m.channelName}` : m.channelId
              const ts = m.timestamp ? new Date(parseFloat(m.timestamp) * 1000).toLocaleDateString('cs-CZ') : ''
              const author = m.username ?? m.userId ?? 'unknown'
              return `- [${ts}] ${channel} | ${author}: ${m.text.slice(0, 300)}`
            })
            .join('\n'),
        )
      }

      if (calendarEvents?.length) {
        sections.push(`## Live: Calendar Events${searchLabel} (${calendarEvents.length})`)
        sections.push(
          calendarEvents
            .map((ev) => {
              const start = ev.start ? new Date(ev.start).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }) : ''
              const attendeeList = ev.attendees
                .slice(0, 4)
                .map((a) => a.displayName ? `${a.displayName} <${a.email}>` : a.email)
                .join(', ')
              return `- [${start}] ${ev.summary}${attendeeList ? ` — ${attendeeList}` : ''}`
            })
            .join('\n'),
        )
      }
    }

    return sections.join('\n\n')
  }
}
