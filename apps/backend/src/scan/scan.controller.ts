/**
 * ScanController
 *
 * Routes:
 *   POST /api/v1/scan        – trigger a new scan (returns 202 immediately)
 *   GET  /api/v1/scan/stream – SSE stream of scan events (blocks until scan completes)
 *
 * Security: Both endpoints require authentication.
 * The SSE stream is authenticated via the JWT in the Authorization header.
 *
 * SSE format per event:
 *   data: <JSON-serialized ScanEvent>\n\n
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { ScanService } from './scan.service'

@Controller('scan')
export class ScanController {
  private readonly logger = new Logger(ScanController.name)

  constructor(private readonly scan: ScanService) {}

  /**
   * POST /api/v1/scan
   * Triggers a new scan and streams its events in the response as SSE.
   * Returns 200 with a text/event-stream body.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async triggerScan(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = user.id
    this.logger.log(`POST /api/v1/scan for user=${userId}`)
    return this.streamScan(userId, res)
  }

  /**
   * GET /api/v1/scan/stream
   * SSE endpoint – triggers a scan and streams events.
   */
  @Get('stream')
  async streamGet(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = user.id
    const language = typeof req.query.language === 'string' ? req.query.language : undefined
    this.logger.log(`GET /api/v1/scan/stream for user=${userId}, language=${language}`)
    return this.streamScan(userId, res, language)
  }

  @Get('status')
  async getStatus(@CurrentUser() user: CurrentUserData) {
    return this.scan.getLatestScanStatus(user.id)
  }

  private async streamScan(userId: string, res: Response, language?: string): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Accel-Buffering', 'no')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    try {
      for await (const event of this.scan.runScan(userId, language)) {
        const data = JSON.stringify(event)
        res.write(`data: ${data}\n\n`)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.logger.error(`Scan SSE error for user=${userId}: ${message}`)
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
    } finally {
      res.end()
    }
  }
}
