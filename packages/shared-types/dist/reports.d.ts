import type { TimeSavedBucket } from './api';
import type { AiUsageBucket } from './settings';
export type ReportGranularity = 'daily' | 'monthly';
export interface ReportRange {
    /** Inclusive UTC calendar date in YYYY-MM-DD format. */
    from: string;
    /** Inclusive UTC calendar date in YYYY-MM-DD format. */
    to: string;
    granularity: ReportGranularity;
}
export interface AiUsageReport extends ReportRange {
    buckets: AiUsageBucket[];
}
export interface TimeSavedReport extends ReportRange {
    buckets: TimeSavedBucket[];
}
//# sourceMappingURL=reports.d.ts.map