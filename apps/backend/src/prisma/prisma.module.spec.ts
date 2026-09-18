import { Test, TestingModule } from '@nestjs/testing'
import { PrismaModule } from './prisma.module'
import { PrismaService } from './prisma.service'

describe('PrismaModule', () => {
  it('should provide and export PrismaService', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile()

    const service = module.get<PrismaService>(PrismaService)
    expect(service).toBeDefined()
    expect(service).toBeInstanceOf(PrismaService)
  })
})
