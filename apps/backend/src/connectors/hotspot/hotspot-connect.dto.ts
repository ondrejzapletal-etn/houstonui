import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

export class HotSpotConnectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  apiKey!: string

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  employeeId!: string
}