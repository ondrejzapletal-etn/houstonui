/**
 * StoreCredentialBody – request body DTO for POST /connectors/:type/credentials
 */

import { IsArray, IsNumber, IsOptional, IsString, MinLength } from 'class-validator'

export class StoreCredentialBody {
  @IsString()
  @MinLength(1)
  accessToken!: string

  @IsString()
  @MinLength(1)
  refreshToken!: string

  @IsArray()
  @IsString({ each: true })
  scopes!: string[]

  @IsOptional()
  @IsString()
  externalAccountId?: string

  /** Unix timestamp (seconds) when the access token expires */
  @IsOptional()
  @IsNumber()
  expiresAt?: number
}
