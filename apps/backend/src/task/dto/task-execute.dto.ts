import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'

export class TaskExecuteDto {
  @IsString()
  @MinLength(3)
  request: string

  @IsOptional()
  @IsString()
  language?: string

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  allowLiveData?: boolean
}
