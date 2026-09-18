import { Controller, Get, Post, Query, Req, Res, HttpCode, HttpStatus } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { CurrentUser, CurrentUserData } from './current-user.decorator'
import { Public } from './public.decorator'
import { SessionService } from './session.service'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Iniciuje OAuth flow – vrací authorization URL.
   * Uloží codeVerifier do server-side state cache pro CSRF validaci v callbacku.
   */
  @Get('login')
  @Public()
  async login(@Res() res: Response) {
    const codeVerifier = this.authService.generateCodeVerifier()
    const codeChallenge = await this.authService.generateCodeChallenge(codeVerifier)
    const state = Buffer.from(crypto.randomUUID()).toString('base64url')

    // Uložíme codeVerifier pro CSRF validaci v callbacku
    await this.authService.storeState(state, codeVerifier)

    const authUrl = this.authService.buildAuthorizationUrl(codeChallenge, state)
    return res.json({ success: true, data: { authUrl, state } })
  }

  /**
   * OAuth callback – validuje state (CSRF ochrana), provede token exchange a vrátí JWT.
   * codeVerifier se načítá ze server-side state cache, nikoliv z query parametrů.
   */
  @Get('callback')
  @Public()
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    if (!code || !state) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        error: { code: 'AUTH_CALLBACK_FAILED', message: 'Missing code or state' },
      })
    }

    // CSRF validace: consumeState vrátí codeVerifier nebo null
    const codeVerifier = await this.authService.consumeState(state)
    if (!codeVerifier) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: { code: 'AUTH_CALLBACK_FAILED', message: 'Invalid or expired state' },
      })
    }

    try {
      const redirectUri = this.configService.getOrThrow<string>('ENTRA_REDIRECT_URI')

      const tokens = await this.authService.exchangeCodeForTokens({
        code,
        codeVerifier,
        redirectUri,
      })

      const userInfo = this.authService.decodeIdToken(tokens.idToken)
      const user = await this.authService.findOrCreateUser({
        entraId: userInfo.oid,
        email: userInfo.email,
        displayName: userInfo.name,
      })

      await this.authService.createSession({
        userId: user.id,
        refreshToken: tokens.refreshToken,
      })

      const accessToken = this.authService.createAccessToken({
        sub: user.id,
        email: user.email,
        entraId: user.entraId ?? undefined,
      })

      // Přesměruj na desktopovou callback URL s tokenem a user info v query parametrech
      const callbackUrl = new URL('/auth/google/callback', this.configService.getOrThrow<string>('DESKTOP_APP_URL'))
      callbackUrl.searchParams.set('token', accessToken)
      callbackUrl.searchParams.set('expiresIn', '900')
      callbackUrl.searchParams.set('userId', user.id)
      callbackUrl.searchParams.set('email', user.email)
      callbackUrl.searchParams.set('displayName', user.displayName ?? '')
      return res.redirect(callbackUrl.toString())
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Callback failed'
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: { code: 'AUTH_CALLBACK_FAILED', message },
      })
    }
  }

  /**
   * Obnoví session z httpOnly cookie – vydá nový JWT bez nutnosti znovu přihlašovat.
   */
  @Get('session')
  @Public()
  async restoreSession(@Req() req: Request, @Res() res: Response) {
    const cookieValue = (req.cookies as Record<string, string>)?.houston_session
    if (!cookieValue) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false })
    }

    const result = await this.authService.validateSessionToken(cookieValue)
    if (!result) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false })
    }

    const { user } = result
    const accessToken = this.authService.createAccessToken({
      sub: user.id,
      email: user.email,
      entraId: user.entraId ?? undefined,
      googleId: user.googleId ?? undefined,
    })

    return res.json({
      success: true,
      data: {
        accessToken,
        expiresIn: 900,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
      },
    })
  }

  /**
   * Vrátí profil přihlášeného uživatele
   */
  @Get('me')
  async me(@CurrentUser() user: CurrentUserData) {
    return {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          entraId: user.entraId,
        },
      },
    }
  }

  /**
   * Logout – invaliduje všechny session uživatele
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: CurrentUserData) {
    await this.sessionService.invalidateAllSessions(user.id)
    return { success: true, data: { message: 'Logged out successfully' } }
  }
}
