import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { GlobalAuthGuard, PUBLIC_ROUTES } from './global-auth.guard'
import { IS_PUBLIC_KEY } from './public.decorator'

// Mock JwtAuthGuard's canActivate
jest.mock('./jwt-auth.guard', () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest()
      // Simulate JWT guard: allow if Authorization header present
      return !!request.headers?.authorization
    }
  },
}))

/**
 * The guard identifies a route by `ClassName.handlerName`, so the fake context
 * must carry real function names – anonymous stubs would all collapse to ''.
 */
function makeContext(opts: {
  isPublic: boolean
  hasToken: boolean
  className?: string
  handlerName?: string
}): ExecutionContext {
  const { isPublic, hasToken, className = 'SomeController', handlerName = 'someHandler' } = opts

  const handler = Object.assign(function () {}, { isPublic, __name: handlerName })
  Object.defineProperty(handler, 'name', { value: handlerName })
  const classRef = function () {}
  Object.defineProperty(classRef, 'name', { value: className })

  return {
    getHandler: () => handler,
    getClass: () => classRef,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: hasToken ? { authorization: 'Bearer token123' } : {},
      }),
    }),
  } as unknown as ExecutionContext
}

describe('GlobalAuthGuard', () => {
  let guard: GlobalAuthGuard
  let reflector: Reflector

  beforeEach(() => {
    reflector = new Reflector()
    guard = new GlobalAuthGuard(reflector)

    // Mock reflector to read isPublic metadata from handler
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key, targets) => {
      if (key === IS_PUBLIC_KEY) {
        const handler = targets[0] as { isPublic?: boolean }
        return handler.isPublic === true
      }
      return undefined
    })
    // Silence the intentional warn for off-allow-list @Public() routes
    jest.spyOn(guard['logger'], 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('allow-listed public routes', () => {
    it('allows an allow-listed public route without a token', () => {
      const context = makeContext({
        isPublic: true,
        hasToken: false,
        className: 'HealthController',
        handlerName: 'check',
      })
      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows an allow-listed public route even with a token', () => {
      const context = makeContext({
        isPublic: true,
        hasToken: true,
        className: 'AuthController',
        handlerName: 'login',
      })
      expect(guard.canActivate(context)).toBe(true)
    })

    it('allows every entry in PUBLIC_ROUTES without a token', () => {
      for (const route of PUBLIC_ROUTES) {
        const [className, handlerName] = route.split('.')
        const context = makeContext({ isPublic: true, hasToken: false, className, handlerName })
        expect(guard.canActivate(context)).toBe(true)
      }
    })
  })

  describe('@Public() outside the allow-list fails closed', () => {
    // This is the regression guard for the audit finding: 61 routes carried
    // @Public() and were reachable with no credentials at all.
    it('denies a @Public() route that is not allow-listed when no token is present', () => {
      const context = makeContext({
        isPublic: true,
        hasToken: false,
        className: 'ProposalsController',
        handlerName: 'approve',
      })
      expect(guard.canActivate(context)).toBe(false)
    })

    it('falls through to the JWT guard for a non-allow-listed @Public() route', () => {
      const context = makeContext({
        isPublic: true,
        hasToken: true,
        className: 'ProposalsController',
        handlerName: 'approve',
      })
      expect(guard.canActivate(context)).toBe(true)
    })

    it('logs a warning naming the offending route', () => {
      const warn = jest.spyOn(guard['logger'], 'warn').mockImplementation(() => undefined)
      const context = makeContext({
        isPublic: true,
        hasToken: true,
        className: 'KnowledgeController',
        handlerName: 'deleteEntity',
      })
      guard.canActivate(context)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('KnowledgeController.deleteEntity'))
    })

    it('does not allow-list a handler name that matches under a different controller', () => {
      // 'callback' is allow-listed on AuthController, not on ConnectorsController
      const context = makeContext({
        isPublic: true,
        hasToken: false,
        className: 'ConnectorsController',
        handlerName: 'callback',
      })
      expect(guard.canActivate(context)).toBe(false)
    })
  })

  describe('routes with no @Public() marker', () => {
    it('requires a token (allow when token present)', () => {
      expect(guard.canActivate(makeContext({ isPublic: false, hasToken: true }))).toBe(true)
    })

    it('denies access without a token', () => {
      expect(guard.canActivate(makeContext({ isPublic: false, hasToken: false }))).toBe(false)
    })
  })
})
