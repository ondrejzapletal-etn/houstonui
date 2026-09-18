import { Controller, Get } from '@nestjs/common'
import { Public } from '../auth/public.decorator'

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  check() {
    return {
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '0.0.1',
      },
    }
  }
}
