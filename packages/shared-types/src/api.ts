export interface ApiSuccess<T = unknown> {
  success: true
  data: T
}

export interface UserStats {
  scansCount: number
  processedMessagesCount: number
  worklogsCount: number
  worklogsSeconds: number
  proposalsCount: number
  autoReadCount: number
  markReadCount: number
}

/** Action kinds that count toward the time-saved summary. */
export const TIME_SAVED_KINDS = [
  'scan',
  'processed_message',
  'auto_read',
  'mark_read',
  'worklog',
] as const

export type TimeSavedKind = (typeof TIME_SAVED_KINDS)[number]

export interface TimeSavedBucket {
  /** 'YYYY-MM-DD' for a daily bucket, 'YYYY-MM' for a monthly one. */
  period: string
  /** Action counts per kind, zero-filled for every known kind. */
  counts: Record<TimeSavedKind, number>
}

export interface TimeSavedSummary {
  /** Last 7 days, oldest first, zero-filled for days with no actions. */
  daily: TimeSavedBucket[]
  /** Last 3 months, oldest first, zero-filled for months with no actions. */
  monthly: TimeSavedBucket[]
}

export interface MarkReadResult {
  status: 'READ'
  source: 'gmail' | 'slack'
  markReadCount: number
  counted: boolean
}

export interface ApiError {
  success: false
  error: {
    code: string
    message: string
  }
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError
