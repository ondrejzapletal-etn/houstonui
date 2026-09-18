/**
 * End-to-end authentication enforcement.
 *
 * Boots the real AppModule with the real GlobalAuthGuard and issues
 * unauthenticated HTTP requests. This is the executable form of the security
 * audit's original probe, which found these endpoints returning 200:
 *
 *   GET /api/v1/proposals          -> 200
 *   GET /api/v1/connectors         -> 200
 *   GET /api/v1/knowledge/entities -> 200
 *   GET /api/v1/clients            -> 200
 *
 * The guard rejects before any handler runs, so these assertions need no
 * database rows – only that the app can be constructed.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request = require('supertest')
import { AppModule } from '../app.module'

/** Endpoints that carried @Public() before the fix and must now require a JWT. */
const MUST_REQUIRE_AUTH: Array<[string, string]> = [
  ['get', '/api/v1/proposals'],
  ['get', '/api/v1/connectors'],
  ['get', '/api/v1/knowledge/entities'],
  ['get', '/api/v1/knowledge/search?q=x'],
  ['get', '/api/v1/clients'],
  ['get', '/api/v1/projects'],
  ['get', '/api/v1/issues'],
  ['get', '/api/v1/calendar-links'],
  ['get', '/api/v1/context'],
  ['get', '/api/v1/scan/stream'],
  ['get', '/api/v1/task/execute?request=hello'],
  ['get', '/api/v1/users/me/stats'],
  ['post', '/api/v1/scan'],
  ['post', '/api/v1/clients'],
  ['post', '/api/v1/issues'],
  ['post', '/api/v1/knowledge/entities'],
  ['post', '/api/v1/gmail/batch-mark-read'],
  // The two that execute real outbound actions / mutate credentials
  ['post', '/api/v1/proposals/some-id/approve'],
  ['post', '/api/v1/connectors/gmail/connect'],
  ['post', '/api/v1/connectors/gmail/disconnect'],
]

/** Endpoints that must stay reachable without a token. */
const MUST_STAY_PUBLIC: Array<[string, string]> = [['get', '/api/v1/health']]

describe('authentication enforcement (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  }, 60_000)

  afterAll(async () => {
    await app?.close()
  })

  it.each(MUST_REQUIRE_AUTH)('%s %s rejects an unauthenticated request', async (method, url) => {
    const res = await (request(app.getHttpServer()) as never as Record<string, CallableFunction>)
      [method](url)
      .send({})

    expect(res.status).toBe(401)
  })

  it.each(MUST_REQUIRE_AUTH)('%s %s rejects a forged bearer token', async (method, url) => {
    const res = await (request(app.getHttpServer()) as never as Record<string, CallableFunction>)
      [method](url)
      .set('Authorization', 'Bearer not.a.real.token')
      .send({})

    expect(res.status).toBe(401)
  })

  it.each(MUST_STAY_PUBLIC)('%s %s stays reachable without a token', async (method, url) => {
    const res = await (request(app.getHttpServer()) as never as Record<string, CallableFunction>)
      [method](url)

    expect(res.status).toBe(200)
  })
})
