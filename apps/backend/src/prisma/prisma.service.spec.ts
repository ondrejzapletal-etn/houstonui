import { Test, TestingModule } from '@nestjs/testing'
import { PrismaService } from './prisma.service'

describe('PrismaService', () => {
  let service: PrismaService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile()

    service = module.get<PrismaService>(PrismaService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('should call $connect on onModuleInit', async () => {
    const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue(undefined)
    await service.onModuleInit()
    expect(connectSpy).toHaveBeenCalledTimes(1)
  })

  it('should call $disconnect on onModuleDestroy', async () => {
    const disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined)
    await service.onModuleDestroy()
    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })
})
