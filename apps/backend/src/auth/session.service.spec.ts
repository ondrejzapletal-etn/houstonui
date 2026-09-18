import { Test, TestingModule } from '@nestjs/testing'
import { SessionService } from './session.service'
import { PrismaService } from '../prisma/prisma.service'

const mockPrisma = {
  session: {
    findMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
}

describe('SessionService', () => {
  let service: SessionService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile()

    service = module.get<SessionService>(SessionService)
    jest.clearAllMocks()
  })

  describe('getActiveSessions', () => {
    it('should return active sessions with expiresAt > now filter', async () => {
      const sessions = [{ id: 's1', userId: 'u1' }]
      mockPrisma.session.findMany.mockResolvedValue(sessions)

      const result = await service.getActiveSessions('u1')

      expect(mockPrisma.session.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(result).toEqual(sessions)
    })

    it('should return empty array when no active sessions', async () => {
      mockPrisma.session.findMany.mockResolvedValue([])
      const result = await service.getActiveSessions('u1')
      expect(result).toEqual([])
    })
  })

  describe('invalidateSession', () => {
    it('should return true when session is successfully deleted', async () => {
      mockPrisma.session.delete.mockResolvedValue({ id: 's1' })

      const result = await service.invalidateSession('s1', 'u1')

      expect(mockPrisma.session.delete).toHaveBeenCalledWith({
        where: { id: 's1', userId: 'u1' },
      })
      expect(result).toBe(true)
    })

    it('should return false when session delete throws (not found)', async () => {
      mockPrisma.session.delete.mockRejectedValue(new Error('Not found'))

      const result = await service.invalidateSession('nonexistent', 'u1')

      expect(result).toBe(false)
    })
  })

  describe('invalidateAllSessions', () => {
    it('should delete all sessions for a user and return count', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 3 })

      const result = await service.invalidateAllSessions('u1')

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      })
      expect(result).toBe(3)
    })

    it('should return 0 when user has no sessions', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 })
      const result = await service.invalidateAllSessions('u1')
      expect(result).toBe(0)
    })
  })

  describe('cleanupExpiredSessions', () => {
    it('should delete expired sessions and return count', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 5 })

      const result = await service.cleanupExpiredSessions()

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      })
      expect(result).toBe(5)
    })

    it('should return 0 when no expired sessions', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 })
      const result = await service.cleanupExpiredSessions()
      expect(result).toBe(0)
    })
  })
})
