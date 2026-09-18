import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/

export class UpsertCalendarIssueLinkDto {
  @IsString()
  @Matches(ISSUE_KEY_PATTERN, {
    message: 'issueKey must be a valid Jira issue key, e.g. "PROJ-123"',
  })
  issueKey!: string

  @IsOptional()
  @IsString()
  projectId?: string

  @IsOptional()
  @IsString()
  recurringEventId?: string
}
