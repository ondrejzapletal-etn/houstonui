// class-transformer needs the metadata shim; Nest's bootstrap normally supplies it.
import 'reflect-metadata'
import { validate } from './env.validation'

/** A production-shaped env with everything the validator requires. */
const base = () => ({
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(32),
  ENTRA_CLIENT_ID: 'client',
  ENTRA_TENANT_ID: 'tenant',
  ENTRA_REDIRECT_URI: 'https://example.com/cb',
  AZURE_KEYVAULT_URL: 'https://vault.vault.azure.net/',
})

describe('env validation – LLM providers', () => {
  it('accepts an OpenAI-only deployment', () => {
    const result = validate({ ...base(), OPENAI_API_KEY: 'sk-openai' })
    expect(result.OPENAI_API_KEY).toBe('sk-openai')
    expect(result.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('accepts an Anthropic-only deployment', () => {
    const result = validate({ ...base(), ANTHROPIC_API_KEY: 'sk-ant' })
    expect(result.ANTHROPIC_API_KEY).toBe('sk-ant')
    expect(result.OPENAI_API_KEY).toBeUndefined()
  })

  it('rejects a deployment with neither key', () => {
    expect(() => validate(base())).toThrow(/At least one of OPENAI_API_KEY \/ ANTHROPIC_API_KEY/)
  })

  // .env.example ships `OPENAI_API_KEY=` blank – copying it must not break boot.
  it('treats a blank key as unset', () => {
    const result = validate({ ...base(), OPENAI_API_KEY: '  ', ANTHROPIC_API_KEY: 'sk-ant' })
    expect(result.OPENAI_API_KEY).toBeUndefined()
  })

  it('rejects a deployment where both keys are blank', () => {
    expect(() => validate({ ...base(), OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' })).toThrow(
      /At least one of/,
    )
  })

  it('accepts a valid AI_PROVIDER and rejects junk', () => {
    expect(validate({ ...base(), OPENAI_API_KEY: 'k', AI_PROVIDER: 'anthropic' }).AI_PROVIDER).toBe(
      'anthropic',
    )
    // errors.toString() renders the constraint name, not the custom message.
    expect(() => validate({ ...base(), OPENAI_API_KEY: 'k', AI_PROVIDER: 'gemini' })).toThrow(
      /AI_PROVIDER has failed the following constraints: isEnum/,
    )
  })

  it('treats a blank AI_PROVIDER as unset rather than invalid', () => {
    expect(
      validate({ ...base(), OPENAI_API_KEY: 'k', AI_PROVIDER: '' }).AI_PROVIDER,
    ).toBeUndefined()
  })

  it('fills in dev placeholders for both providers when neither key is set', () => {
    const result = validate({ ...base(), NODE_ENV: 'development' })
    expect(result.OPENAI_API_KEY).toBe('sk-test-placeholder')
    expect(result.ANTHROPIC_API_KEY).toBe('sk-ant-test-placeholder')
  })

  it('does not invent a second key in dev when one is already configured', () => {
    const result = validate({ ...base(), NODE_ENV: 'development', ANTHROPIC_API_KEY: 'sk-ant-real' })
    expect(result.ANTHROPIC_API_KEY).toBe('sk-ant-real')
    expect(result.OPENAI_API_KEY).toBeUndefined()
  })
})
