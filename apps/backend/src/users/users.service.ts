import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export interface UserStats {
  scansCount: number
  processedMessagesCount: number
  worklogsCount: number
  worklogsSeconds: number
  proposalsCount: number
  autoReadCount: number
  markReadCount: number
}

export interface JiraWorklogStatsCache {
  count: number
  seconds: number
  updatedAt: Date
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getIdentity(userId: string): Promise<{ email: string; displayName: string } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true },
    })
  }

  async getUserStats(userId: string): Promise<UserStats> {
    const [user, proposalsCount] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.proposal.count({ where: { userId } }),
    ])
    return {
      scansCount: user?.scansCount ?? 0,
      processedMessagesCount: user?.processedMessagesCount ?? 0,
      worklogsCount: user?.worklogsCount ?? 0,
      worklogsSeconds: user?.worklogsSeconds ?? 0,
      proposalsCount,
      autoReadCount: user?.autoReadCount ?? 0,
      markReadCount: user?.markReadCount ?? 0,
    }
  }

  async incrementAutoRead(userId: string, count: number): Promise<number> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { autoReadCount: { increment: count } },
    });
    return user.autoReadCount;
  }

  async incrementMarkRead(userId: string): Promise<number> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { markReadCount: { increment: 1 } },
    })
    return user.markReadCount
  }

  async getCachedJiraWorklogStats(userId: string): Promise<JiraWorklogStatsCache | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        jiraWorklogsCount: true,
        jiraWorklogsSeconds: true,
        jiraWorklogsStatsUpdatedAt: true,
      },
    })
    if (
      !user ||
      user.jiraWorklogsCount === null ||
      user?.jiraWorklogsSeconds === null ||
      user.jiraWorklogsStatsUpdatedAt === null
    ) {
      return null
    }
    return {
      count: user.jiraWorklogsCount,
      seconds: user.jiraWorklogsSeconds,
      updatedAt: user.jiraWorklogsStatsUpdatedAt,
    }
  }

  async cacheJiraWorklogStats(userId: string, count: number, seconds: number): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        jiraWorklogsCount: count,
        jiraWorklogsSeconds: seconds,
        jiraWorklogsStatsUpdatedAt: new Date(),
      },
    })
  }

  async incrementProcessedMessages(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { processedMessagesCount: { increment: 1 } },
    });
    return { processedMessagesCount: user.processedMessagesCount };
  }

  async incrementScans(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { scansCount: { increment: 1 } },
    })
    return { scansCount: user.scansCount }
  }

  async incrementWorklogs(userId: string, seconds: number) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { worklogsCount: { increment: 1 }, worklogsSeconds: { increment: seconds } },
    })
    return { worklogsCount: user.worklogsCount, worklogsSeconds: user.worklogsSeconds }
  }

  async decrementWorklogs(userId: string, seconds: number): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        worklogsCount: { decrement: 1 },
        worklogsSeconds: { decrement: seconds },
      },
    })
  }

  async adjustWorklogSeconds(userId: string, deltaSeconds: number): Promise<void> {
    if (deltaSeconds === 0) return
    await this.prisma.user.update({
      where: { id: userId },
      data: { worklogsSeconds: { increment: deltaSeconds } },
    })
  }
}
