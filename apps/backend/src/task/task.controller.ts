import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { TaskOrchestratorService } from './task-orchestrator.service'

@Controller('task')
export class TaskController {
  private readonly logger = new Logger(TaskController.name)

  constructor(private readonly orchestrator: TaskOrchestratorService) {}

  /**
   * GET /api/v1/task/execute
   * Accepts a natural language request and streams the orchestration result as SSE.
   *
   * Query params:
   *   request       – the user's task (required)
   *   language      – 'cs' | 'en' (optional)
   *   allowLiveData – 'true' | 'false' (optional, default false)
   */
  @Get('execute')
  async execute(
    @CurrentUser() user: CurrentUserData,
    @Query('request') request: string,
    @Query('language') language: string | undefined,
    @Query('allowLiveData') allowLiveDataParam: string | undefined,
    @Req() _req: Request,
    @Res() res: Response,
  ) {
    const userId = user.id
    const allowLiveData = allowLiveDataParam === 'true'

    if (!request || request.trim().length < 3) {
      res.status(400).json({ error: 'request query param is required (min 3 chars)' })
      return
    }

    this.logger.log(
      `GET /api/v1/task/execute user=${userId} allowLiveData=${allowLiveData} lang=${language}`,
    )

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Accel-Buffering', 'no')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    try {
      for await (const event of this.orchestrator.runTask(
        userId,
        request.trim(),
        allowLiveData,
        language,
      )) {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.logger.error(`Task SSE error for user=${userId}: ${message}`)
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
    } finally {
      res.end()
    }
  }
}
