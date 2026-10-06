import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator'

export class CreateProposalFromSourceMessageDto {
  @IsIn(['gmail', 'slack'])
  source!: 'gmail' | 'slack'

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  messageId?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  channelId?: string

  @IsOptional()
  @Matches(/^\d{1,16}\.\d{1,16}$/)
  ts?: string
}