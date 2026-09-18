import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Vrátí aktivní session pro uživatele (ne-expirované)
   */
  async getActiveSessions(userId: string) {
    return this.prisma.session.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Invaliduje konkrétní session
   */
  async invalidateSession(sessionId: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.session.delete({
        where: { id: sessionId, userId },
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Invaliduje všechny session uživatele (logout ze všech zařízení)
   */
  async invalidateAllSessions(userId: string): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { userId },
    })
    return result.count
  }

  /**
   * Smaže expirované session (cleanup job)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    return result.count
  }
}
