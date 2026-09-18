/**
 * KeyVaultService
 *
 * Thin wrapper around Azure Key Vault Secrets SDK.
 * All connector OAuth tokens are stored here – NEVER in the database.
 *
 * Error mapping:
 *  - Secret not found            → CredentialNotFoundException
 *  - Secret disabled / deleted   → CredentialInvalidException
 *  - Any other Azure error        → rethrown as-is (upstream handles)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SecretClient } from '@azure/keyvault-secrets'
import { DefaultAzureCredential } from '@azure/identity'
import {
  CredentialNotFoundException,
  CredentialInvalidException,
} from './connector-credential.errors'

/** Path to the dev-only persistent token file (relative to CWD = apps/backend). */
const DEV_TOKENS_FILE = path.join(process.cwd(), '.dev-tokens.json')

@Injectable()
export class KeyVaultService implements OnModuleInit {
  private readonly logger = new Logger(KeyVaultService.name)
  private client!: SecretClient
  /** DEV ONLY: in-memory store used when Azure Key Vault is not available locally. */
  private readonly devStore = new Map<string, string>()
  private devMode = false

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const vaultUrl = this.config.getOrThrow<string>('AZURE_KEYVAULT_URL')
    const isDev = this.config.get<string>('NODE_ENV') === 'development'
    // Use in-memory store in development mode to avoid requiring local Azure credentials.
    // Set KEY_VAULT_FORCE_AZURE=true in .env to use real Key Vault even in development.
    const forceAzure = this.config.get<string>('KEY_VAULT_FORCE_AZURE') === 'true'
    if (isDev && !forceAzure) {
      this.devMode = true
      this.loadDevTokensFromDisk()
      this.logger.warn(
        '[DEV-ONLY] KeyVaultService: Using in-memory secret store backed by .dev-tokens.json. ' +
          'NEVER use this in production!',
      )
      return
    }
    this.client = new SecretClient(vaultUrl, new DefaultAzureCredential())
    this.logger.log(`KeyVaultService initialised – vault: ${vaultUrl}`)
  }

  /**
   * DEV ONLY: Load secrets from .dev-tokens.json into devStore on startup.
   * This allows tokens to survive backend restarts during local development.
   */
  private loadDevTokensFromDisk(): void {
    try {
      if (!fs.existsSync(DEV_TOKENS_FILE)) return
      const raw = fs.readFileSync(DEV_TOKENS_FILE, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, string>
      for (const [name, value] of Object.entries(parsed)) {
        this.devStore.set(name, value)
      }
      this.logger.log(
        `[DEV] Loaded ${this.devStore.size} secret(s) from .dev-tokens.json`,
      )
    } catch (err) {
      this.logger.warn(`[DEV] Could not load .dev-tokens.json: ${String(err)}`)
    }
  }

  /**
   * DEV ONLY: Persist devStore to .dev-tokens.json so tokens survive restarts.
   */
  private persistDevTokensToDisk(): void {
    try {
      const obj: Record<string, string> = {}
      for (const [k, v] of this.devStore.entries()) {
        obj[k] = v
      }
      fs.writeFileSync(DEV_TOKENS_FILE, JSON.stringify(obj, null, 2), 'utf8')
    } catch (err) {
      this.logger.warn(`[DEV] Could not persist .dev-tokens.json: ${String(err)}`)
    }
  }

  /**
   * Store or update a secret value.
   * Returns the created/updated secret version.
   */
  async setSecret(name: string, value: string): Promise<void> {
    if (this.devMode) {
      this.devStore.set(name, value)
      this.persistDevTokensToDisk()
      this.logger.debug(`[DEV] Secret set and persisted to disk: ${name}`)
      return
    }
    await this.client.setSecret(name, value)
    this.logger.debug(`Secret set: ${name}`)
  }

  /**
   * Retrieve a secret value.
   *
   * @throws CredentialNotFoundException  when the secret does not exist
   * @throws CredentialInvalidException   when the secret is disabled or marked for deletion
   */
  async getSecret(name: string): Promise<string> {
    if (this.devMode) {
      const value = this.devStore.get(name)
      if (value === undefined) {
        throw new CredentialNotFoundException(`[DEV] In-memory secret "${name}" not found.`)
      }
      return value
    }
    try {
      const result = await this.client.getSecret(name)

      if (!result.properties.enabled) {
        throw new CredentialInvalidException(`Key Vault secret "${name}" is disabled.`)
      }

      if (result.value === undefined || result.value === null) {
        throw new CredentialInvalidException(`Key Vault secret "${name}" has no value.`)
      }

      return result.value
    } catch (err: unknown) {
      // Re-throw our own errors unchanged
      if (err instanceof CredentialNotFoundException || err instanceof CredentialInvalidException) {
        throw err
      }

      // Azure SDK throws RestError with statusCode 404 when secret not found
      if (isAzureNotFound(err)) {
        throw new CredentialNotFoundException(`Key Vault secret "${name}" not found.`)
      }

      throw err
    }
  }

  /**
   * Soft-delete a secret (Key Vault recoverable delete).
   * Does NOT throw if the secret is already absent.
   */
  async deleteSecret(name: string): Promise<void> {
    if (this.devMode) {
      this.devStore.delete(name)
      this.persistDevTokensToDisk()
      this.logger.debug(`[DEV] Secret deleted from memory and disk: ${name}`)
      return
    }
    try {
      const poller = await this.client.beginDeleteSecret(name)
      await poller.pollUntilDone()
      this.logger.debug(`Secret deleted: ${name}`)
    } catch (err: unknown) {
      if (isAzureNotFound(err)) {
        this.logger.warn(`Secret "${name}" already absent – skipping delete.`)
        return
      }
      throw err
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function isAzureNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    (err as { statusCode: number }).statusCode === 404
  )
}
