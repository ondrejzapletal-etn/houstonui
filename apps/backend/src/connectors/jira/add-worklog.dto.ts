import { IsString, IsNotEmpty, IsInt, IsOptional, Min, MaxLength, Matches } from 'class-validator'

/**
 * Validated request body for POST /connectors/jira/worklogs.
 *
 * Validation rules mirror the shared-types AddWorklogRequest interface and
 * the Atlassian Jira Cloud REST API v3 constraints:
 *  - issueKey: non-empty string matching the Jira key pattern
 *  - date:     ISO date "YYYY-MM-DD"
 *  - timeSpentSeconds: positive integer ≥ 60
 *  - comment:  optional plain-text string, max 255 chars
 */
export class AddWorklogDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z][A-Z0-9_]*-\d+$/, {
    message: 'issueKey must be a valid Jira issue key, e.g. "PROJ-123"',
  })
  issueKey!: string

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in ISO format YYYY-MM-DD',
  })
  date!: string

  @IsInt()
  @Min(60, { message: 'timeSpentSeconds must be at least 60 (1 minute)' })
  timeSpentSeconds!: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  comment?: string
}
