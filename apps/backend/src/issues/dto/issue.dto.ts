import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { Transform } from 'class-transformer'

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/

export class UpsertJiraIssueDto {
  @IsString()
  @Matches(ISSUE_KEY_PATTERN, {
    message: 'issueKey must be a valid Jira issue key, e.g. "PROJ-123"',
  })
  issueKey!: string

  @IsString()
  @MaxLength(500)
  summary!: string

  @IsOptional()
  @IsString()
  projectId?: string
}

export class IssueSearchQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string

  @IsOptional()
  @IsString()
  projectId?: string

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeInactive?: boolean
}
