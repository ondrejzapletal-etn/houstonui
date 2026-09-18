/**
 * ConnectorCredentialsController
 *
 * Internal REST endpoints for direct credential management.
 * These routes are intended for administrative use; the user-facing OAuth flow
 * is handled by ConnectorsController.
 *
 * Routes:
 *   GET    /connectors/:type/credentials  – get credential metadata (no tokens)
 *   POST   /connectors/:type/credentials  – store/replace tokens
 *   DELETE /connectors/:type/credentials  – revoke connector
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ConnectorType } from '@prisma/client'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { ConnectorCredentialsService, StoreCredentialDto } from './connector-credentials.service'
import { ConnectorTypeParam } from './connector-type.pipe'
import { StoreCredentialBody } from './store-credential.dto'

@Controller('connectors')
export class ConnectorCredentialsController {
  constructor(private readonly credentials: ConnectorCredentialsService) {}

  /** Get credential metadata for a single connector (no tokens). */
  @Get(':type/credentials')
  getCredential(
    @CurrentUser() user: CurrentUserData,
    @Param('type', ConnectorTypeParam) connectorType: ConnectorType,
  ) {
    return this.credentials.getMetadata(user.id, connectorType)
  }

  /**
   * Store (create or replace) OAuth tokens for a connector.
   * Tokens are stored in Azure Key Vault; only metadata lives in the DB.
   * Intended for administrative token injection (e.g. service accounts).
   */
  @Post(':type/credentials')
  @HttpCode(HttpStatus.OK)
  storeCredential(
    @CurrentUser() user: CurrentUserData,
    @Param('type', ConnectorTypeParam) connectorType: ConnectorType,
    @Body() body: StoreCredentialBody,
  ) {
    const dto: StoreCredentialDto = {
      userId: user.id,
      connectorType,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      scopes: body.scopes,
      externalAccountId: body.externalAccountId,
      expiresAt: body.expiresAt,
    }
    return this.credentials.storeCredential(dto)
  }

  /** Revoke (delete) a connector credential immediately. */
  @Delete(':type/credentials')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeCredential(
    @CurrentUser() user: CurrentUserData,
    @Param('type', ConnectorTypeParam) connectorType: ConnectorType,
  ): Promise<void> {
    await this.credentials.revokeCredential(user.id, connectorType)
  }
}
