import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class GmailScanSuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async removeFromLatestScan(userId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return

    const scanRun = await this.prisma.scanRun.findFirst({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, metadata: true },
    })
    if (!scanRun || !isRecord(scanRun.metadata)) return

    const suggestions = scanRun.metadata.autoReadSuggestions
    if (!Array.isArray(suggestions)) return

    const removedIds = new Set(messageIds)
    const remainingSuggestions = suggestions.filter(
      (suggestion) => !isRecord(suggestion) ||
        typeof suggestion.messageId !== 'string' ||
        !removedIds.has(suggestion.messageId),
    )

    await this.prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        metadata: {
          ...scanRun.metadata,
          autoReadSuggestions: remainingSuggestions,
        } as Prisma.InputJsonObject,
      },
    })
  }
}

function isRecord(value: unknown): value is Record<string, Prisma.JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}