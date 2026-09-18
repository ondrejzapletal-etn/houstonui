/** Supported connector types */
export type ConnectorType = 'gmail' | 'slack' | 'jira' | 'clockify' | 'hotspot';
/**
 * Connection state visible to the frontend.
 *
 * - `connected`      – OAuth token is valid; unreadCount is available
 * - `not_connected`  – user has never connected or explicitly disconnected
 * - `token_expired`  – refresh token is expired; user must re-authorise
 * - `error`          – transient error fetching counts (token still valid)
 * - `warning`        – connected, but a non-credential dependency is unavailable
 */
export type ConnectorConnectionStatus = 'connected' | 'not_connected' | 'token_expired' | 'error' | 'warning';
/** Shape returned by GET /connectors/:type/status */
export interface ConnectorStatusData {
    type: ConnectorType;
    status: ConnectorConnectionStatus;
    connectedAt?: string;
    errorMessage?: string;
}
/** Shape returned by POST /connectors/:type/connect */
export interface ConnectorConnectData {
    authUrl: string;
}
/** Shape returned by DELETE /connectors/:type/disconnect */
export interface ConnectorDisconnectData {
    message: string;
}
/**
 * Runtime information for a single connector including live unread counts.
 * Returned by GET /api/v1/connectors.
 */
export interface ConnectorInfo {
    /** Stable machine-readable identifier */
    id: ConnectorType;
    /** Human-readable display name (e.g. "Gmail", "Slack") */
    label: string;
    /** Current lifecycle status */
    status: ConnectorConnectionStatus;
    /**
     * Number of unread items (emails / DMs + mentions).
     * Only present when status === 'connected'; null otherwise.
     */
    unreadCount: number | null;
    /** ISO-8601 timestamp of when the count was last successfully fetched */
    lastCheckedAt: string | null;
    /** Optional detail for an error or warning connector status. */
    errorMessage?: string;
}
/** Response body of GET /api/v1/connectors */
export interface ConnectorsListResponse {
    connectors: ConnectorInfo[];
}
/**
 * Worklog data for a single month, keyed by day-of-month.
 * Values are total logged seconds for that day.
 * Days with no logged time are absent from the record.
 */
export interface ClockifyWorklogResponse {
    year: number;
    month: number;
    /** Map of day-of-month (1-based) → total logged seconds */
    secondsPerDay: Record<number, number>;
}
export interface JiraWorklogResponse {
    year: number;
    month: number;
    /** Map of day-of-month (1-based) → total logged seconds */
    secondsPerDay: Record<number, number>;
}
/** Aggregated historical Jira worklogs for the authenticated user. */
export interface JiraWorklogStatsResponse {
    count: number;
    seconds: number;
}
export interface HotSpotVacationResponse {
    year: number;
    month: number;
    /** Total vacation duration in seconds for the selected employee and month. */
    seconds: number;
}
/**
 * Request body for POST /connectors/jira/worklogs
 * Adds a single worklog entry to a Jira issue on behalf of the user.
 */
export interface AddWorklogRequest {
    /** Jira issue key, e.g. "PROJ-123" */
    issueKey: string;
    /** Calendar date in ISO format "YYYY-MM-DD" */
    date: string;
    /** Time spent, in seconds. Must be a positive integer (minimum 60). */
    timeSpentSeconds: number;
    /** Optional worklog comment (plain text, max 255 chars) */
    comment?: string;
}
/** Response body for POST /connectors/jira/worklogs */
export interface AddWorklogResponse {
    /** Jira worklog ID of the newly created entry */
    worklogId: string;
    /** ISO timestamp of when the worklog was started */
    started: string;
    /** Seconds logged */
    timeSpentSeconds: number;
}
/**
 * Request body for POST /connectors/clockify/worklogs
 * Adds a single worklog entry to Clockify.
 */
export interface AddClockifyWorklogRequest {
    /** Optional Jira issue key for cross-reference only. */
    issueKey?: string;
    /** Clockify project ID. Most Clockify workspaces require this; obtain from monthly issues or manual input. */
    projectId?: string;
    /** Calendar date in ISO format "YYYY-MM-DD" */
    date: string;
    /** Time spent, in seconds. Must be a positive integer (minimum 60). */
    timeSpentSeconds: number;
    /** Optional entry description/comment (max 255 chars) */
    comment?: string;
}
/** Response body for POST /connectors/clockify/worklogs */
export interface AddClockifyWorklogResponse {
    worklogId: string;
    started: string;
    timeSpentSeconds: number;
}
/** Request body for PUT /connectors/jira/worklogs/:worklogId */
export interface UpdateWorklogRequest {
    issueKey: string;
    date: string;
    timeSpentSeconds: number;
    comment?: string;
    /** Original seconds — used server-side to compute the worklogsSeconds delta */
    oldTimeSpentSeconds?: number;
}
/** Response body for PUT /connectors/jira/worklogs/:worklogId */
export interface UpdateWorklogResponse {
    worklogId: string;
    started: string;
    timeSpentSeconds: number;
}
/** Query params for DELETE /connectors/jira/worklogs/:worklogId */
export interface DeleteWorklogRequest {
    issueKey: string;
    oldTimeSpentSeconds?: number;
}
/** Single Jira worklog entry as returned by GET /connectors/jira/worklogs/day */
export interface JiraWorklogDayEntry {
    /** Jira worklog ID */
    id: string;
    /** Jira issue key, e.g. "PROJ-42" */
    issueId: string;
    /** Jira issue summary (title) */
    issueName?: string;
    /** ISO 8601 timestamp of when the work started */
    started: string;
    /** Time spent in seconds */
    timeSpentSeconds: number;
    /** Optional worklog comment (plain text) */
    comment?: string;
}
export interface JiraWorklogDayResponse {
    date: string;
    worklogs: JiraWorklogDayEntry[];
}
/** Single Clockify time entry as returned by GET /connectors/clockify/worklogs/day */
export interface ClockifyWorklogDayEntry {
    /** Clockify time entry ID */
    id: string;
    /** Clockify project name or ID */
    project?: string;
    /** Entry description */
    description?: string;
    /** ISO 8601 timestamp of when the work started */
    started: string;
    /** Duration in seconds */
    timeSpentSeconds: number;
}
export interface ClockifyWorklogDayResponse {
    date: string;
    worklogs: ClockifyWorklogDayEntry[];
}
/** Aggregated month entry for the Worklogs "issues" overview. */
export interface MonthlyWorklogIssueEntry {
    /** Data source (Jira issue or Clockify issue-like item). */
    source: 'jira' | 'clockify';
    /** Primary label shown in the list (Jira key or Clockify project). */
    reference: string;
    /** Optional Clockify project ID when source === 'clockify'. */
    clockifyProjectId?: string;
    /** Secondary label shown in the list (Jira summary or Clockify description). */
    title?: string;
    /** Total logged seconds in the selected month. */
    totalSeconds: number;
    /** Jira issue key usable for pre-filling Add Worklog modal. */
    jiraIssueKey?: string;
}
/** Response body for GET /connectors/worklogs/monthly-issues */
export interface MonthlyWorklogIssuesResponse {
    year: number;
    month: number;
    issues: MonthlyWorklogIssueEntry[];
}
/** Single worklog entry within a monthly issue detail response. */
export interface MonthlyIssueWorklogEntry {
    source: 'jira' | 'clockify';
    id: string;
    issueId?: string;
    issueName?: string;
    started: string;
    timeSpentSeconds: number;
    comment?: string;
    description?: string;
    project?: string;
}
/** Response body for GET /connectors/worklogs/monthly-issues/:source/:reference */
export interface MonthlyIssueWorklogsResponse {
    year: number;
    month: number;
    source: 'jira' | 'clockify';
    reference: string;
    worklogs: MonthlyIssueWorklogEntry[];
}
/** Error codes specific to the connectors domain */
export type ConnectorErrorCode = 'CONNECTOR_NOT_FOUND' | 'CONNECTOR_TOKEN_EXPIRED' | 'CONNECTOR_FETCH_FAILED' | 'CONNECTOR_UNAUTHORIZED';
//# sourceMappingURL=connector.d.ts.map