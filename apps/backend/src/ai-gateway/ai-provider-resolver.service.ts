/**
 * Resolves which LLM provider a given user's requests should go to.
 *
 * Precedence: the user's saved choice (users.aiProvider) → the deployment
 * default (env AI_PROVIDER) → OPENAI. A null column means "not chosen", so
 * flipping AI_PROVIDER moves every user who never picked one.
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import type { LlmProviderName } from './providers/llm-provider.interface'

/** Short enough that a settings change lands quickly even without invalidation. */
const CACHE_TTL_MS = 60_000

@Injectable()
export class AiProviderResolver {
  private readonly logger = new Logger(AiProviderResolver.name)
  private readonly cache = new Map<string, { value: LlmProviderName | null; expiresAt: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** The deployment-wide default for users who have not chosen. */
  systemDefault(): LlmProviderName {
    const raw = this.config.get<string>('AI_PROVIDER')?.trim().toUpperCase()
    return raw === 'ANTHROPIC' ? 'ANTHROPIC' : 'OPENAI'
  }

  /** The user's explicit choice, or null if they have not made one. */
  async getUserPreference(userId: string): Promise<LlmProviderName | null> {
    const cached = this.cache.get(userId)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    let value: LlmProviderName | null = null
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { aiProvider: true },
      })
      value = (user?.aiProvider as LlmProviderName | null | undefined) ?? null
    } catch (err) {
      // A settings lookup must never take down an LLM call – fall back to the
      // deployment default and let the request through.
      this.logger.warn(
        `Could not read aiProvider for user=${userId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }

    this.cache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    return value
  }

  /** The provider to actually use for this user. */
  async resolve(userId?: string): Promise<LlmProviderName> {
    if (!userId) return this.systemDefault()
    return (await this.getUserPreference(userId)) ?? this.systemDefault()
  }

  /** Call after writing users.aiProvider so the next request sees the new value. */
  invalidate(userId: string): void {
    this.cache.delete(userId)
  }
}
