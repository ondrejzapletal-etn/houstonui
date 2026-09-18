import { Injectable, ExecutionContext, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtAuthGuard } from './jwt-auth.guard'
import { IS_PUBLIC_KEY } from './public.decorator'

/**
 * Routes that may legitimately be reached without a JWT, as
 * `ControllerClassName.handlerMethodName`.
 *
 * `@Public()` alone is NOT sufficient to open a route – a handler must appear
 * here as well. The decorator is advisory; this list is authoritative. That way
 * a stray or forgotten `@Public()` fails closed instead of silently exposing an
 * endpoint, which is exactly how the whole API came to be unauthenticated.
 *
 * Adding an entry here is a security decision. Justify it in review:
 *  - auth/* – the login and callback handshake, which by definition runs before
 *    a token exists. The OAuth callbacks are protected by a single-use `state`
 *    plus PKCE rather than by a bearer token.
 *  - ConnectorsController.handleCallback – the provider's redirect target;
 *    same state + PKCE protection.
 *  - HealthController.check – liveness probe, returns no user data.
 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'AuthController.login',
  'AuthController.callback',
  'AuthController.restoreSession',
  'GoogleAuthController.googleAuth',
  'GoogleAuthController.googleCallback',
  'ConnectorsController.handleCallback',
  'HealthController.check',
])

@Injectable()
export class GlobalAuthGuard extends JwtAuthGuard {
  private readonly logger = new Logger(GlobalAuthGuard.name)

  constructor(private reflector: Reflector) {
    super()
  }

  canActivate(context: ExecutionContext) {
    const isMarkedPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (isMarkedPublic) {
      const route = `${context.getClass().name}.${context.getHandler().name}`

      if (PUBLIC_ROUTES.has(route)) {
        return true
      }

      // A route carries @Public() but is not on the allow-list: require auth
      // anyway and make the discrepancy visible instead of failing open.
      this.logger.warn(
        `Route ${route} is marked @Public() but is not in PUBLIC_ROUTES – ` +
          'requiring authentication. Remove the decorator or add the route to the allow-list.',
      )
    }

    return super.canActivate(context)
  }
}
