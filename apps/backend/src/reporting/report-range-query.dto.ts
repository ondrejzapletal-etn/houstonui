import { IsIn, Matches } from 'class-validator'
import type { ReportGranularity } from './report-range'

export class ReportRangeQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string

  @IsIn(['daily', 'monthly'])
  granularity!: ReportGranularity
}