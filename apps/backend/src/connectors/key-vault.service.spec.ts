import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { KeyVaultService } from './key-vault.service'
import {
  CredentialInvalidException,
  CredentialNotFoundException,
} from './connector-credential.errors'

// ─── Azure SDK mock ───────────────────────────────────────────────────────────

const mockSetSecret = jest.fn()
const mockGetSecret = jest.fn()
const mockBeginDeleteSecret = jest.fn()

jest.mock('@azure/keyvault-secrets', () => ({
  SecretClient: jest.fn().mockImplementation(() => ({
    setSecret: mockSetSecret,
    getSecret: mockGetSecret,
    beginDeleteSecret: mockBeginDeleteSecret,
  })),
}))

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}))

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('KeyVaultService', () => {
  let service: KeyVaultService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyVaultService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('https://test.vault.azure.net/'),
          },
        },
      ],
    }).compile()

    service = module.get(KeyVaultService)
    // Trigger onModuleInit to create the client
    await service.onModuleInit()
  })

  // ── setSecret ─────────────────────────────────────────────────────────────

  describe('setSecret', () => {
    it('calls SecretClient.setSecret with name and value', async () => {
      mockSetSecret.mockResolvedValueOnce({})
      await service.setSecret('my-secret', 'token-value')
      expect(mockSetSecret).toHaveBeenCalledWith('my-secret', 'token-value')
    })

    it('propagates Azure errors', async () => {
      mockSetSecret.mockRejectedValueOnce(new Error('network error'))
      await expect(service.setSecret('x', 'y')).rejects.toThrow('network error')
    })
  })

  // ── getSecret ─────────────────────────────────────────────────────────────

  describe('getSecret', () => {
    it('returns the secret value when enabled', async () => {
      mockGetSecret.mockResolvedValueOnce({
        value: 'my-token',
        properties: { enabled: true },
      })
      const result = await service.getSecret('my-secret')
      expect(result).toBe('my-token')
    })

    it('throws CredentialNotFoundException when Azure returns 404', async () => {
      const notFound = Object.assign(new Error('not found'), { statusCode: 404 })
      mockGetSecret.mockRejectedValueOnce(notFound)
      await expect(service.getSecret('missing')).rejects.toThrow(CredentialNotFoundException)
    })

    it('throws CredentialInvalidException when secret is disabled', async () => {
      mockGetSecret.mockResolvedValueOnce({
        value: 'some-value',
        properties: { enabled: false },
      })
      await expect(service.getSecret('disabled')).rejects.toThrow(CredentialInvalidException)
    })

    it('throws CredentialInvalidException when secret value is null', async () => {
      mockGetSecret.mockResolvedValueOnce({
        value: null,
        properties: { enabled: true },
      })
      await expect(service.getSecret('null-value')).rejects.toThrow(CredentialInvalidException)
    })

    it('re-throws unknown Azure errors', async () => {
      const serverError = Object.assign(new Error('server error'), { statusCode: 500 })
      mockGetSecret.mockRejectedValueOnce(serverError)
      await expect(service.getSecret('x')).rejects.toMatchObject({ statusCode: 500 })
    })
  })

  // ── deleteSecret ──────────────────────────────────────────────────────────

  describe('deleteSecret', () => {
    it('soft-deletes a secret via beginDeleteSecret', async () => {
      const poller = { pollUntilDone: jest.fn().mockResolvedValueOnce(undefined) }
      mockBeginDeleteSecret.mockResolvedValueOnce(poller)
      await service.deleteSecret('my-secret')
      expect(mockBeginDeleteSecret).toHaveBeenCalledWith('my-secret')
      expect(poller.pollUntilDone).toHaveBeenCalled()
    })

    it('does NOT throw when secret is already absent (404)', async () => {
      const notFound = Object.assign(new Error('not found'), { statusCode: 404 })
      mockBeginDeleteSecret.mockRejectedValueOnce(notFound)
      await expect(service.deleteSecret('missing')).resolves.toBeUndefined()
    })

    it('propagates non-404 errors', async () => {
      const err = Object.assign(new Error('forbidden'), { statusCode: 403 })
      mockBeginDeleteSecret.mockRejectedValueOnce(err)
      await expect(service.deleteSecret('x')).rejects.toMatchObject({ statusCode: 403 })
    })
  })
})
