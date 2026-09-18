/**
 * ConnectorCredentialsService
 *
 * Manages OAuth credentials for Gmail and Slack connectors.
 *
 * Architecture:
 *  - Tokens (access + refresh) are NEVER stored in the database.
 *  - Only a reference (Key Vault secret name) and metadata live in DB.
 *  - Actual token bytes live exclusively in Azure Key Vault.
 *
 * Secret naming convention:
 *   conn-{connectorType}-{credentialId}
 *
 *   Example: conn-gmail-cldxyz123
 *
 * Secret value format: JSON – { accessToken, refreshToken, obtainedAt }
 */

import { Injectable, Logger } from '@nestjs/common'
import { ConnectorStatus, ConnectorType } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { KeyVaultService } from './key-vault.service'
import {
  CredentialExpiredException,
  CredentialInvalidException,
  CredentialNotFoundException,
} from './connector-credential.errors'

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface StoreCredentialDto {
  userId: string
  connectorType: ConnectorType
  accessToken: string
  refreshToken: string
  scopes: string[]
  externalAccountId?: string
  /** Unix timestamp (seconds) of access token expiry */
  expiresAt?: number
  /** Jira-specific: Atlassian accountId, stored in Key Vault token payload */
  accountId?: string
  /** Clockify-specific: workspace ID, stored in Key Vault token payload */
  workspaceId?: string
}

export interface ConnectorCredentialMeta {
  id: string
  userId: string
  connectorType: ConnectorType
  status: ConnectorStatus
  scopes: string[]
  externalAccountId: string | null
  tokenExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ConnectorTokens {
  accessToken: string
  refreshToken: string
  obtainedAt: string
  /** Jira-specific: Atlassian accountId (stored alongside tokens, never sent to frontend) */
  accountId?: string
  /** Clockify-specific: Clockify workspace ID */
  workspaceId?: string
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ConnectorCredentialsService {
  private readonly logger = new Logger(ConnectorCredentialsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyVault: KeyVaultService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Store (create or replace) OAuth tokens for a connector.
   *
   * 1. Upsert the metadata record in DB to obtain/confirm the credential id.
   * 2. Persist token bytes in Key Vault under the deterministic name.
   * 3. Mark the record ACTIVE.
   */
  async storeCredential(dto: StoreCredentialDto): Promise<ConnectorCredentialMeta> {
    const secretName = this.buildSecretName(dto.userId, dto.connectorType)

    // Upsert DB record first so we have a stable id and secret name
    const record = await this.prisma.connectorCredential.upsert({
      where: {
        userId_connectorType: {
          userId: dto.userId,
          connectorType: dto.connectorType,
        },
      },
      create: {
        userId: dto.userId,
        connectorType: dto.connectorType,
        keyVaultSecretName: secretName,
        status: ConnectorStatus.ACTIVE,
        scopes: dto.scopes,
        externalAccountId: dto.externalAccountId ?? null,
        tokenExpiresAt: dto.expiresAt ? new Date(dto.expiresAt * 1000) : null,
      },
      update: {
        keyVaultSecretName: secretName,
        status: ConnectorStatus.ACTIVE,
        scopes: dto.scopes,
        // Preserve, don't clear, when the caller omits it. A token refresh only
        // carries the new tokens; wiping externalAccountId there would drop the
        // Jira cloudId resolved during the OAuth callback and force a reconnect.
        ...(dto.externalAccountId !== undefined
          ? { externalAccountId: dto.externalAccountId }
          : {}),
        tokenExpiresAt: dto.expiresAt ? new Date(dto.expiresAt * 1000) : null,
      },
    })

    // Persist the actual token value in Key Vault.
    // Merge over the previous payload so a refresh that only carries new tokens
    // keeps the provider identifiers stored alongside them (Jira accountId,
    // Clockify workspaceId) instead of silently dropping them.
    const previous = await this.readTokensOrNull(secretName)
    const accountId = dto.accountId ?? previous?.accountId
    const workspaceId = dto.workspaceId ?? previous?.workspaceId

    const payload: ConnectorTokens = {
      accessToken: dto.accessToken,
      refreshToken: dto.refreshToken,
      obtainedAt: new Date().toISOString(),
      ...(accountId !== undefined ? { accountId } : {}),
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    }
    await this.keyVault.setSecret(secretName, JSON.stringify(payload))

    this.logger.log(`Stored credentials for user=${dto.userId} connector=${dto.connectorType}`)
    return this.toMeta(record)
  }

  /**
   * Retrieve tokens for a connector.
   *
   * @throws CredentialNotFoundException  when no record exists
   * @throws CredentialExpiredException   when status is EXPIRED
   * @throws CredentialInvalidException   when status is INVALID or REVOKED
   */
  async getTokens(userId: string, connectorType: ConnectorType): Promise<ConnectorTokens> {
    const record = await this.findRecord(userId, connectorType)
    this.assertUsable(record)

    const raw = await this.keyVault.getSecret(record.keyVaultSecretName)
    return JSON.parse(raw) as ConnectorTokens
  }

  /**
   * Return credential metadata (no tokens) for a single connector.
   *
   * @throws CredentialNotFoundException when no record exists
   */
  async getMetadata(
    userId: string,
    connectorType: ConnectorType,
  ): Promise<ConnectorCredentialMeta> {
    const record = await this.findRecord(userId, connectorType)
    return this.toMeta(record)
  }

  /**
   * List all connector credential metadata for a user (no tokens).
   */
  async listCredentials(userId: string): Promise<ConnectorCredentialMeta[]> {
    const records = await this.prisma.connectorCredential.findMany({
      where: { userId },
      orderBy: { connectorType: 'asc' },
    })
    return records.map((r) => this.toMeta(r))
  }

  /**
   * Revoke a connector credential.
   * Deletes the token from Key Vault and marks the DB record REVOKED.
   * Does NOT throw if the credential does not exist.
   */
  async revokeCredential(userId: string, connectorType: ConnectorType): Promise<void> {
    const record = await this.prisma.connectorCredential.findUnique({
      where: { userId_connectorType: { userId, connectorType } },
    })

    if (!record) {
      this.logger.warn(
        `Revoke requested but no credential found: user=${userId} connector=${connectorType}`,
      )
      return
    }

    // Delete from Key Vault first (idempotent)
    await this.keyVault.deleteSecret(record.keyVaultSecretName)

    // Mark as REVOKED in DB (keep audit trail)
    await this.prisma.connectorCredential.update({
      where: { id: record.id },
      data: { status: ConnectorStatus.REVOKED },
    })

    this.logger.log(`Revoked credentials for user=${userId} connector=${connectorType}`)
  }

  /**
   * Mark a credential as EXPIRED (called by token-refresh logic or scheduler).
   */
  async markExpired(userId: string, connectorType: ConnectorType): Promise<void> {
    await this.prisma.connectorCredential.updateMany({
      where: { userId, connectorType, status: ConnectorStatus.ACTIVE },
      data: { status: ConnectorStatus.EXPIRED },
    })
    this.logger.warn(`Marked EXPIRED: user=${userId} connector=${connectorType}`)
  }

  /**
   * Mark a credential as INVALID (called when provider rejects the token).
   */
  async markInvalid(userId: string, connectorType: ConnectorType): Promise<void> {
    await this.prisma.connectorCredential.updateMany({
      where: { userId, connectorType },
      data: { status: ConnectorStatus.INVALID },
    })
    this.logger.warn(`Marked INVALID: user=${userId} connector=${connectorType}`)
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Best-effort read of an existing Key Vault token payload.
   * Returns null when the secret is absent or unparseable (first connect).
   */
  private async readTokensOrNull(secretName: string): Promise<ConnectorTokens | null> {
    try {
      const raw = await this.keyVault.getSecret(secretName)
      return JSON.parse(raw) as ConnectorTokens
    } catch {
      return null
    }
  }

  private async findRecord(userId: string, connectorType: ConnectorType) {
    const record = await this.prisma.connectorCredential.findUnique({
      where: { userId_connectorType: { userId, connectorType } },
    })
    if (!record) {
      throw new CredentialNotFoundException(`No ${connectorType} credential for user ${userId}.`)
    }
    return record
  }

  private assertUsable(record: {
    status: ConnectorStatus
    connectorType: ConnectorType
    userId: string
  }): void {
    switch (record.status) {
      case ConnectorStatus.ACTIVE:
        return
      case ConnectorStatus.EXPIRED:
        throw new CredentialExpiredException(
          `${record.connectorType} credential for user ${record.userId} has expired.`,
        )
      case ConnectorStatus.INVALID:
        throw new CredentialInvalidException(
          `${record.connectorType} credential for user ${record.userId} is invalid.`,
        )
      case ConnectorStatus.REVOKED:
        throw new CredentialInvalidException(
          `${record.connectorType} credential for user ${record.userId} was revoked.`,
        )
    }
  }

  /**
   * Build a deterministic Key Vault secret name for a user + connector.
   * Format: conn-{connectorType.toLowerCase()}-{userId}
   * Key Vault names may only contain alphanumeric characters and hyphens.
   */
  private buildSecretName(userId: string, connectorType: ConnectorType): string {
    return `conn-${connectorType.toLowerCase()}-${userId}`
  }

  private toMeta(record: {
    id: string
    userId: string
    connectorType: ConnectorType
    status: ConnectorStatus
    scopes: string[]
    externalAccountId: string | null
    tokenExpiresAt: Date | null
    createdAt: Date
    updatedAt: Date
  }): ConnectorCredentialMeta {
    return {
      id: record.id,
      userId: record.userId,
      connectorType: record.connectorType,
      status: record.status,
      scopes: record.scopes,
      externalAccountId: record.externalAccountId,
      tokenExpiresAt: record.tokenExpiresAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }
}
