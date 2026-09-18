import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator'

const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,9}$/

export class CreateProjectDto {
  @IsOptional()
  @IsString()
  clientId?: string

  @IsString()
  @MaxLength(200)
  name!: string

  @IsOptional()
  @IsString()
  @Matches(JIRA_KEY_PATTERN, {
    message: 'jiraProjectKey must be an uppercase Jira project key, e.g. "PROJ"',
  })
  jiraProjectKey?: string

  @IsOptional()
  @IsEmail()
  pmEmail?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  clientId?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string

  @IsOptional()
  @IsString()
  @Matches(JIRA_KEY_PATTERN, {
    message: 'jiraProjectKey must be an uppercase Jira project key, e.g. "PROJ"',
  })
  jiraProjectKey?: string

  @IsOptional()
  @IsEmail()
  pmEmail?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
