import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator'

/**
 * Validated request body for POST /connectors/clockify/connect.
 *
 * Clockify uses API key authentication – there is no OAuth flow.
 * The API key is treated as a long-lived credential stored in Key Vault.
 *
 * Validation rules:
 *  - apiKey:      required non-empty string, max 128 characters
 *  - workspaceId: optional; when omitted the backend uses the user's
 *                 `activeWorkspace` returned by the Clockify /user endpoint
 */
export class ClockifyConnectDto {
  @IsString()
  @IsNotEmpty({ message: 'apiKey must not be empty' })
  @MaxLength(128, { message: 'apiKey must not exceed 128 characters' })
  apiKey!: string

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'workspaceId must not exceed 64 characters' })
  workspaceId?: string
}
