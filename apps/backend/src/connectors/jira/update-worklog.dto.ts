import { IsString, IsNotEmpty, IsInt, IsOptional, Min, MaxLength, Matches } from 'class-validator'

export class UpdateWorklogDto {
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

  @IsOptional()
  @IsInt()
  @Min(60)
  oldTimeSpentSeconds?: number
}
