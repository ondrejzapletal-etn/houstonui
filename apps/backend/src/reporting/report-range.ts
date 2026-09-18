import { BadRequestException } from '@nestjs/common'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MILLISECONDS_PER_DAY = 86_400_000
const MAXIMUM_RANGE_DAYS = 366

export type ReportGranularity = 'daily' | 'monthly'

export interface ReportRange {
  from: string
  to: string
  granularity: ReportGranularity
}

export interface ReportRangeWindow extends ReportRange {
  fromDate: Date
  toDateExclusive: Date
  periodKeys: string[]
}

function utcDate(value: string, field: 'from' | 'to'): Date {
  if (!ISO_DATE.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD format`)
  }

  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} must be a valid calendar date`)
  }
  return date
}

function createPeriodKeys(
  fromDate: Date,
  toDateExclusive: Date,
  granularity: ReportGranularity,
): string[] {
  const keys: string[] = []
  const cursor = new Date(fromDate)

  if (granularity === 'daily') {
    while (cursor < toDateExclusive) {
      keys.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return keys
  }

  cursor.setUTCDate(1)
  while (cursor < toDateExclusive) {
    keys.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return keys
}

export function createReportRangeWindow(
  range: ReportRange,
  now = new Date(),
): ReportRangeWindow {
  const fromDate = utcDate(range.from, 'from')
  const toDate = utcDate(range.to, 'to')
  const toDateExclusive = new Date(toDate)
  toDateExclusive.setUTCDate(toDateExclusive.getUTCDate() + 1)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  if (fromDate > toDate) {
    throw new BadRequestException('from must not be after to')
  }
  if (toDate > today) {
    throw new BadRequestException('to must not be in the future')
  }
  if ((toDateExclusive.getTime() - fromDate.getTime()) / MILLISECONDS_PER_DAY > MAXIMUM_RANGE_DAYS) {
    throw new BadRequestException(`The maximum report range is ${MAXIMUM_RANGE_DAYS} days`)
  }

  return {
    ...range,
    fromDate,
    toDateExclusive,
    periodKeys: createPeriodKeys(fromDate, toDateExclusive, range.granularity),
  }
}