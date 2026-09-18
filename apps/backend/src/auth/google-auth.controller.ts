import { Controller, Get, Query, Res, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';

@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Initiuje Google OAuth flow – přesměruje uživatele na Google login.
   * State je uložen server-side (stejný vzor jako Entra ID PKCE flow).
   */
  @Get()
  @Public()
  async googleAuth(@Res() res: Response) {
    const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.config.getOrThrow<string>('GOOGLE_CALLBACK_URL');

    const state = Buffer.from(crypto.randomUUID()).toString('base64url');
    // LOG: generovaný state
    console.log('[Google OAuth start] Generated state:', state);
    // Reuse pendingStates – codeVerifier je zde jen placeholder (Google nepoužívá PKCE v tomto flow)
    await this.authService.storeState(state, 'google-oauth');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      access_type: 'offline',
    });

    return res.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    );
  }

  /**
   * Google OAuth callback – validuje state, vymění code za tokeny, vrátí JWT.
   */
  @Get('callback')
  @Public()
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    // LOG: příchozí parametry
    console.log('[Google OAuth callback] query:', { code, state, error });

    if (error) {
      console.error('[Google OAuth callback] Error param:', error);
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: { code: 'AUTH_GOOGLE_DENIED', message: error },
      });
    }

    if (!code || !state) {
      console.error('[Google OAuth callback] Missing code or state', { code, state });
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        error: { code: 'AUTH_CALLBACK_FAILED', message: 'Missing code or state' },
      });
    }

    const storedState = await this.authService.consumeState(state);
    if (!storedState) {
      console.error('[Google OAuth callback] Invalid or expired state', { state });
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: { code: 'AUTH_CALLBACK_FAILED', message: 'Invalid or expired state' },
      });
    }

    try {
      const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
      const clientSecret = this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET');
      const redirectUri = this.config.getOrThrow<string>('GOOGLE_CALLBACK_URL');

      // Exchange code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        throw new Error(`Google token exchange failed: ${body}`);
      }

      const tokenData = (await tokenRes.json()) as {
        id_token: string;
        access_token: string;
      };

      // Decode id_token to get user info (Google OIDC)
      const userInfo = this.authService.decodeIdToken(tokenData.id_token);

      const user = await this.authService.findOrCreateGoogleUser({
        googleId: userInfo.oid,
        email: userInfo.email,
        displayName: userInfo.name,
      });

      // Vytvoříme backend session (stejný vzor jako Entra ID flow)
      const rawSessionToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      const sessionId = await this.authService.createSession({
        userId: user.id,
        refreshToken: rawSessionToken,
      });

      const accessToken = this.authService.createAccessToken({
        sub: user.id,
        email: user.email,
        googleId: user.googleId ?? undefined,
      });

      const frontendUrl = new URL(
        `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/auth/google/callback`,
      );
      frontendUrl.searchParams.set('token', accessToken);
      frontendUrl.searchParams.set('expiresIn', '900');
      frontendUrl.searchParams.set('userId', user.id);
      frontendUrl.searchParams.set('email', user.email);
      frontendUrl.searchParams.set('displayName', user.displayName);

      // httpOnly session cookie: sessionId.rawToken (O(1) lookup při obnově session)
      res.cookie('houston_session', `${sessionId}.${rawSessionToken}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dní
      });

      return res.redirect(frontendUrl.toString());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google callback failed';
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: { code: 'AUTH_CALLBACK_FAILED', message },
      });
    }
  }
}
