import { Test, TestingModule } from '@nestjs/testing'
import { HealthController } from './health.controller'

describe('HealthController', () => {
  let controller: HealthController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile()

    controller = module.get<HealthController>(HealthController)
  })

  describe('check()', () => {
    it('should return success === true', () => {
      const result = controller.check()
      expect(result.success).toBe(true)
    })

    it('should return data.status === "ok"', () => {
      const result = controller.check()
      expect(result.data.status).toBe('ok')
    })

    it('should return data.version === "0.0.1"', () => {
      const result = controller.check()
      expect(result.data.version).toBe('0.0.1')
    })

    it('should return data.timestamp as a valid ISO 8601 string', () => {
      const result = controller.check()
      const parsed = new Date(result.data.timestamp)
      expect(parsed.toISOString()).toBe(result.data.timestamp)
    })
  })
})
