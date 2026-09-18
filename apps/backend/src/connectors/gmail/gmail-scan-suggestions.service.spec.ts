import { Test } from '@nestjs/testing'
import { PrismaService } from '../../prisma/prisma.service'
import { GmailScanSuggestionsService } from './gmail-scan-suggestions.service'

describe('GmailScanSuggestionsService', () => {
  const prisma = {
    scanRun: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  }
  let service: GmailScanSuggestionsService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module = await Test.createTestingModule({
      providers: [
        GmailScanSuggestionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()
    service = module.get(GmailScanSuggestionsService)
  })

  it('removes marked messages from the latest scan while preserving metadata', async () => {
    prisma.scanRun.findFirst.mockResolvedValue({
      id: 'scan-1',
      metadata: {
        totalItems: 2,
        autoReadSuggestions: [
          { messageId: 'message-1', subject: 'First' },
          { messageId: 'message-2', subject: 'Second' },
        ],
      },
    })

    await service.removeFromLatestScan('user-1', ['message-1'])

    expect(prisma.scanRun.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, metadata: true },
    })
    expect(prisma.scanRun.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: {
        metadata: {
          totalItems: 2,
          autoReadSuggestions: [{ messageId: 'message-2', subject: 'Second' }],
        },
      },
    })
  })
})