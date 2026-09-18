import type { GmailScanEmail } from '../connectors/gmail/gmail.service'
import type { SlackScanResult } from '../connectors/slack/slack.service'
import type { ClassifiedItem } from './scan-classifier.service'
import type { ScanSourceData } from './scan-fetcher.service'

export type RelevanceRejectionReason =
  | 'missing_source'
  | 'not_addressed'
  | 'invalid_client'
  | 'old_message_unverified'
  | 'old_message_resolved'

export interface RelevancePolicyOptions {
  now: Date
  ageThresholdDays: number
  clientIds: ReadonlySet<string>
}

export interface RelevanceDecision {
  allowed: boolean
  reason?: RelevanceRejectionReason
}

const DAY_MS = 24 * 60 * 60 * 1000

export function evaluateProposalRelevance(
  item: ClassifiedItem,
  data: ScanSourceData,
  options: RelevancePolicyOptions,
): RelevanceDecision {
  if (item.system === 'gmail') {
    const email = data.gmail.emails.find((candidate) => candidate.messageId === item.externalId)
    return evaluateGmail(item, email, options)
  }

  if (item.system === 'slack') {
    const message = findSlackMessage(data.slack.result, item.externalId)
    return evaluateSlack(item, message?.message, message?.conversationType, options)
  }

  return { allowed: true }
}

function evaluateGmail(
  item: ClassifiedItem,
  email: GmailScanEmail | undefined,
  options: RelevancePolicyOptions,
): RelevanceDecision {
  if (!email) return { allowed: false, reason: 'missing_source' }
  const directlyAddressed = email.recipientRole === 'to'
  return evaluateMessage(item, directlyAddressed, email.receivedAt, email.resolution, options)
}

function evaluateSlack(
  item: ClassifiedItem,
  message: SlackScanResult['channels'][number]['messages'][number] | undefined,
  conversationType: SlackScanResult['channels'][number]['conversationType'] | undefined,
  options: RelevancePolicyOptions,
): RelevanceDecision {
  if (!message) return { allowed: false, reason: 'missing_source' }
  const directlyAddressed = conversationType === 'dm' || message.mentionsCurrentUser === true
  const occurredAt = Number(message.ts) * 1000
  return evaluateMessage(item, directlyAddressed, occurredAt, message.resolution, options)
}

function evaluateMessage(
  item: ClassifiedItem,
  directlyAddressed: boolean,
  occurredAt: string | number,
  resolution: 'answered' | 'unresolved' | 'unknown' | undefined,
  options: RelevancePolicyOptions,
): RelevanceDecision {
  const isClientException = item.tier === 2
    && typeof item.detectedClientId === 'string'
    && options.clientIds.has(item.detectedClientId)
  if (!directlyAddressed && !isClientException) {
    return { allowed: false, reason: item.detectedClientId ? 'invalid_client' : 'not_addressed' }
  }

  const timestamp = typeof occurredAt === 'number' ? occurredAt : Date.parse(occurredAt)
  if (!Number.isFinite(timestamp) || timestamp >= options.now.getTime() - options.ageThresholdDays * DAY_MS) {
    return { allowed: true }
  }
  if (resolution === 'unresolved') return { allowed: true }
  if (resolution === 'answered') return { allowed: false, reason: 'old_message_resolved' }
  return { allowed: false, reason: 'old_message_unverified' }
}

function findSlackMessage(result: SlackScanResult, externalId?: string) {
  if (!externalId) return undefined
  for (const channel of result.channels) {
    const message = channel.messages.find((candidate) => candidate.ts === externalId)
    if (message) return { message, conversationType: channel.conversationType }
  }
  return undefined
}