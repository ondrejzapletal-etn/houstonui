import { plainToInstance } from 'class-transformer'
import {
  IsEnum,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUrl,
  IsInt,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator'

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** Deployment-wide default LLM provider for users who have not chosen one. */
export enum AiProviderEnv {
  OpenAi = 'openai',
  Anthropic = 'anthropic',
}

class EnvironmentVariables {
  /**
   * Required, not inferred. Several security decisions branch on this value –
   * the session cookie's `secure` flag and the Key Vault dev bypass among them –
   * so an unset or misspelled NODE_ENV must stop the boot rather than quietly
   * resolve to "not production".
   */
  @IsEnum(NodeEnv, {
    message: `NODE_ENV must be one of: ${Object.values(NodeEnv).join(', ')}`,
  })
  NODE_ENV!: NodeEnv

  /** Signing key for Houston's own access tokens. Generate: openssl rand -base64 32 */
  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET!: string

  @IsString()
  @IsNotEmpty()
  ENTRA_CLIENT_ID!: string

  @IsString()
  @IsNotEmpty()
  ENTRA_TENANT_ID!: string

  @IsString()
  @IsNotEmpty()
  ENTRA_REDIRECT_URI!: string

  /**
   * Azure Key Vault endpoint URL.
   * Example: https://my-vault.vault.azure.net/
   */
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  AZURE_KEYVAULT_URL!: string

  /**
   * LLM API keys – used by AiGatewayService (ADR-001 OpenAI, ADR-003 Anthropic).
   * Never exposed to clients.
   *
   * Individually optional, but at least one must be set (checked in validate()):
   * the provider is a per-user setting, so a deployment may legitimately run on
   * either key alone. A user pointed at a provider whose key is missing gets a
   * clear error from that provider, not a failed boot.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  OPENAI_API_KEY?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ANTHROPIC_API_KEY?: string

  /** Default provider for users with no explicit choice. Defaults to openai. */
  @IsOptional()
  @IsEnum(AiProviderEnv, {
    message: `AI_PROVIDER must be one of: ${Object.values(AiProviderEnv).join(', ')}`,
  })
  AI_PROVIDER?: AiProviderEnv

  /** Age after which scan candidates require verified unresolved thread state. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  SCAN_MESSAGE_AGE_THRESHOLD_DAYS?: number
}

/** Placeholders below are only ever substituted outside production. */
const DEV_FAKE_KEYVAULT_URL = 'http://localhost/dev-fake-keyvault/'
const DEV_PLACEHOLDER_OPENAI_KEY = 'sk-test-placeholder'
const DEV_PLACEHOLDER_ANTHROPIC_KEY = 'sk-ant-test-placeholder'

/**
 * Optional vars that a .env may legitimately carry as a blank line
 * (`OPENAI_API_KEY=`, as shipped in .env.example). class-validator's @IsOptional
 * only skips null/undefined, so a blank would otherwise fail @IsNotEmpty.
 */
const BLANKABLE_OPTIONAL_VARS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_PROVIDER'] as const

export function validate(config: Record<string, unknown>) {
  const nodeEnv = (config.NODE_ENV ?? process.env.NODE_ENV) as string | undefined
  const isLocal = nodeEnv === NodeEnv.Development || nodeEnv === NodeEnv.Test

  // "Set but empty" means "not set" for these – normalise before anything reads them.
  for (const key of BLANKABLE_OPTIONAL_VARS) {
    if (typeof config[key] === 'string' && (config[key] as string).trim() === '') {
      delete config[key]
    }
  }

  // Local convenience only: stand in for infrastructure that a laptop has no
  // credentials for. Deliberately never applied in production – a production
  // container with an incomplete environment must fail to start.
  if (isLocal) {
    const keyVaultUrl = config.AZURE_KEYVAULT_URL
    if (typeof keyVaultUrl !== 'string' || !keyVaultUrl.startsWith('http')) {
      config.AZURE_KEYVAULT_URL = DEV_FAKE_KEYVAULT_URL
    }
    if (!config.OPENAI_API_KEY && !config.ANTHROPIC_API_KEY) {
      config.OPENAI_API_KEY = DEV_PLACEHOLDER_OPENAI_KEY
      config.ANTHROPIC_API_KEY = DEV_PLACEHOLDER_ANTHROPIC_KEY
    }
  }

  // Either key alone is a valid deployment; neither is not – nothing could run.
  if (!config.OPENAI_API_KEY && !config.ANTHROPIC_API_KEY) {
    throw new Error(
      'Environment validation failed:\nAt least one of OPENAI_API_KEY / ANTHROPIC_API_KEY must be set',
    )
  }

  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  })
  const errors = validateSync(validated, { skipMissingProperties: false })
  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.toString()}`)
  }
  return validated
}
