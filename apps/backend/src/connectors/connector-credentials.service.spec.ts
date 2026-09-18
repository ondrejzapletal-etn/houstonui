import { Test, TestingModule } from '@nestjs/testing'
import { ConnectorStatus, ConnectorType } from '@prisma/client'
import { ConnectorCredentialsService } from './connector-credentials.service'
import { KeyVaultService } from './key-vault.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  CredentialExpiredException,
  CredentialInvalidException,
  CredentialNotFoundException,
} from './connector-credential.errors'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const USER_ID = 'user-abc'
const CONNECTOR_TYPE = ConnectorType.GMAIL

interface CredentialRecord {
  id: string
  userId: string
  connectorType: ConnectorType
  keyVaultSecretName: string
  status: ConnectorStatus
  scopes: string[]
  externalAccountId: string | null
  tokenExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function makeRecord(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    id: 'cred-1',
    userId: USER_ID,
    connectorType: CONNECTOR_TYPE,
    keyVaultSecretName: `conn-gmail-${USER_ID}`,
    status: ConnectorStatus.ACTIVE,
    scopes: ['https://mail.google.com/'],
    externalAccountId: 'user@gmail.com',
    tokenExpiresAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  connectorCredential: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
}

const mockKv = {
  setSecret: jest.fn(),
  getSecret: jest.fn(),
  deleteSecret: jest.fn(),
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConnectorCredentialsService', () => {
  let service: ConnectorCredentialsService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorCredentialsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KeyVaultService, useValue: mockKv },
      ],
    }).compile()

    service = module.get(ConnectorCredentialsService)
  })

  // ── storeCredential ────────────────────────────────────────────────────────

  describe('storeCredential', () => {
    it('upserts DB record and sets KV secret', async () => {
      const record = makeRecord()
      mockPrisma.connectorCredential.upsert.mockResolvedValueOnce(record)
      mockKv.setSecret.mockResolvedValueOnce(undefined)

      const result = await service.storeCredential({
        userId: USER_ID,
        connectorType: CONNECTOR_TYPE,
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        scopes: ['https://mail.google.com/'],
        externalAccountId: 'user@gmail.com',
        expiresAt: 9999999999,
      })

      expect(mockPrisma.connectorCredential.upsert).toHaveBeenCalledTimes(1)
      expect(mockKv.setSecret).toHaveBeenCalledWith(
        `conn-gmail-${USER_ID}`,
        expect.stringContaining('"accessToken":"access-123"'),
      )
      expect(result.status).toBe(ConnectorStatus.ACTIVE)
      expect(result.connectorType).toBe(CONNECTOR_TYPE)
    })

    it('stores refreshToken in KV payload', async () => {
      mockPrisma.connectorCredential.upsert.mockResolvedValueOnce(makeRecord())
      mockKv.setSecret.mockResolvedValueOnce(undefined)

      await service.storeCredential({
        userId: USER_ID,
        connectorType: CONNECTOR_TYPE,
        accessToken: 'at',
        refreshToken: 'rt-secret',
        scopes: [],
      })

      const kvCall = mockKv.setSecret.mock.calls[0]
      const payload = JSON.parse(kvCall[1] as string)
      expect(payload.refreshToken).toBe('rt-secret')
    })

    it('preserves externalAccountId when the caller omits it (token refresh)', async () => {
      mockPrisma.connectorCredential.upsert.mockResolvedValueOnce(makeRecord())
      mockKv.setSecret.mockResolvedValueOnce(undefined)

      await service.storeCredential({
        userId: USER_ID,
        connectorType: ConnectorType.JIRA,
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        scopes: ['read:jira-work'],
        // externalAccountId intentionally omitted – this is a refresh, not a connect
      })

      const upsertArg = mockPrisma.connectorCredential.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>
      }
      expect(upsertArg.update).not.toHaveProperty('externalAccountId')
    })

    it('clears externalAccountId only when explicitly set to null-ish by a connect', async () => {
      mockPrisma.connectorCredential.upsert.mockResolvedValueOnce(makeRecord())
      mockKv.setSecret.mockResolvedValueOnce(undefined)

      await service.storeCredential({
        userId: USER_ID,
        connectorType: ConnectorType.JIRA,
        accessToken: 'at',
        refreshToken: 'rt',
        scopes: [],
        externalAccountId: 'cloud-xyz',
      })

      const upsertArg = mockPrisma.connectorCredential.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>
      }
      expect(upsertArg.update.externalAccountId).toBe('cloud-xyz')
    })

    it('preserves accountId/workspaceId from the previous KV payload when omitted', async () => {
      mockPrisma.connectorCredential.upsert.mockResolvedValueOnce(makeRecord())
      mockKv.getSecret.mockResolvedValueOnce(
        JSON.stringify({
          accessToken: 'old-at',
          refreshToken: 'old-rt',
          obtainedAt: '2026-01-01T00:00:00.000Z',
          accountId: 'atlassian-account-1',
          workspaceId: 'ws-1',
        }),
      )
      mockKv.setSecret.mockResolvedValueOnce(undefined)

      await service.storeCredential({
        userId: USER_ID,
        connectorType: ConnectorType.JIRA,
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        scopes: ['read:jira-work'],
      })

      const payload = JSON.parse(mockKv.setSecret.mock.calls[0][1] as string)
      expect(payload.accessToken).toBe('new-at')
      expect(payload.accountId).toBe('atlassian-account-1')
      expect(payload.workspaceId).toBe('ws-1')
    })

    it('lets an explicit accountId override the previous KV payload', async () => {
      mockPrisma.connectorCredential.upsert.mockResolvedValueOnce(makeRecord())
      mockKv.getSecret.mockResolvedValueOnce(
        JSON.stringify({ accessToken: 'a', refreshToken: 'r', obtainedAt: 'x', accountId: 'old' }),
      )
      mockKv.setSecret.mockResolvedValueOnce(undefined)

      await service.storeCredential({
        userId: USER_ID,
        connectorType: ConnectorType.JIRA,
        accessToken: 'at',
        refreshToken: 'rt',
        scopes: [],
        accountId: 'new',
      })

      const payload = JSON.parse(mockKv.setSecret.mock.calls[0][1] as string)
      expect(payload.accountId).toBe('new')
    })
  })

  // ── getTokens ──────────────────────────────────────────────────────────────

  describe('getTokens', () => {
    const tokens = { accessToken: 'at', refreshToken: 'rt', obtainedAt: '2026-01-01T00:00:00.000Z' }

    it('returns parsed tokens for an ACTIVE credential', async () => {
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(makeRecord())
      mockKv.getSecret.mockResolvedValueOnce(JSON.stringify(tokens))

      const result = await service.getTokens(USER_ID, CONNECTOR_TYPE)
      expect(result.accessToken).toBe('at')
      expect(result.refreshToken).toBe('rt')
    })

    it('throws CredentialNotFoundException when DB record absent', async () => {
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(null)
      await expect(service.getTokens(USER_ID, CONNECTOR_TYPE)).rejects.toThrow(
        CredentialNotFoundException,
      )
    })

    it('throws CredentialExpiredException when status is EXPIRED', async () => {
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(
        makeRecord({ status: ConnectorStatus.EXPIRED }),
      )
      await expect(service.getTokens(USER_ID, CONNECTOR_TYPE)).rejects.toThrow(
        CredentialExpiredException,
      )
    })

    it('throws CredentialInvalidException when status is INVALID', async () => {
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(
        makeRecord({ status: ConnectorStatus.INVALID }),
      )
      await expect(service.getTokens(USER_ID, CONNECTOR_TYPE)).rejects.toThrow(
        CredentialInvalidException,
      )
    })

    it('throws CredentialInvalidException when status is REVOKED', async () => {
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(
        makeRecord({ status: ConnectorStatus.REVOKED }),
      )
      await expect(service.getTokens(USER_ID, CONNECTOR_TYPE)).rejects.toThrow(
        CredentialInvalidException,
      )
    })

    it('propagates KV errors for ACTIVE credentials', async () => {
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(makeRecord())
      mockKv.getSecret.mockRejectedValueOnce(new CredentialNotFoundException('gone'))
      await expect(service.getTokens(USER_ID, CONNECTOR_TYPE)).rejects.toThrow(
        CredentialNotFoundException,
      )
    })
  })

  // ── getMetadata ────────────────────────────────────────────────────────────

  describe('getMetadata', () => {
    it('returns metadata without tokens', async () => {
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(makeRecord())
      const meta = await service.getMetadata(USER_ID, CONNECTOR_TYPE)
      expect(meta).not.toHaveProperty('accessToken')
      expect(meta).not.toHaveProperty('refreshToken')
      expect(meta.connectorType).toBe(CONNECTOR_TYPE)
    })

    it('throws CredentialNotFoundException when absent', async () => {
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(null)
      await expect(service.getMetadata(USER_ID, CONNECTOR_TYPE)).rejects.toThrow(
        CredentialNotFoundException,
      )
    })
  })

  // ── listCredentials ────────────────────────────────────────────────────────

  describe('listCredentials', () => {
    it('returns all credential metadata for a user', async () => {
      const records = [makeRecord(), makeRecord({ connectorType: ConnectorType.SLACK })]
      mockPrisma.connectorCredential.findMany.mockResolvedValueOnce(records)

      const list = await service.listCredentials(USER_ID)
      expect(list).toHaveLength(2)
      expect(list[0]).not.toHaveProperty('accessToken')
    })

    it('returns empty array when user has no credentials', async () => {
      mockPrisma.connectorCredential.findMany.mockResolvedValueOnce([])
      const list = await service.listCredentials(USER_ID)
      expect(list).toEqual([])
    })
  })

  // ── revokeCredential ───────────────────────────────────────────────────────

  describe('revokeCredential', () => {
    it('deletes from KV and marks DB record REVOKED', async () => {
      const record = makeRecord()
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(record)
      mockKv.deleteSecret.mockResolvedValueOnce(undefined)
      mockPrisma.connectorCredential.update.mockResolvedValueOnce({
        ...record,
        status: ConnectorStatus.REVOKED,
      })

      await service.revokeCredential(USER_ID, CONNECTOR_TYPE)

      expect(mockKv.deleteSecret).toHaveBeenCalledWith(record.keyVaultSecretName)
      expect(mockPrisma.connectorCredential.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ConnectorStatus.REVOKED },
        }),
      )
    })

    it('does NOT throw when credential is already absent', async () => {
      mockPrisma.connectorCredential.findUnique.mockResolvedValueOnce(null)
      await expect(service.revokeCredential(USER_ID, CONNECTOR_TYPE)).resolves.toBeUndefined()
      expect(mockKv.deleteSecret).not.toHaveBeenCalled()
    })
  })

  // ── markExpired / markInvalid ──────────────────────────────────────────────

  describe('markExpired', () => {
    it('updates status to EXPIRED', async () => {
      mockPrisma.connectorCredential.updateMany.mockResolvedValueOnce({ count: 1 })
      await service.markExpired(USER_ID, CONNECTOR_TYPE)
      expect(mockPrisma.connectorCredential.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ConnectorStatus.EXPIRED } }),
      )
    })
  })

  describe('markInvalid', () => {
    it('updates status to INVALID', async () => {
      mockPrisma.connectorCredential.updateMany.mockResolvedValueOnce({ count: 1 })
      await service.markInvalid(USER_ID, CONNECTOR_TYPE)
      expect(mockPrisma.connectorCredential.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ConnectorStatus.INVALID } }),
      )
    })
  })
})
