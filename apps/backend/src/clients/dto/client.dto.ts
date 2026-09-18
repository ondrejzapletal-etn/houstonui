import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateClientDto {
  @IsString()
  @MaxLength(200)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(253)
  domain?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(253)
  domain?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}
