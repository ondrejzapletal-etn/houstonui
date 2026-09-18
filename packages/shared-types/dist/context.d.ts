/** Shared types for the Houston Context feature — aggregated view of all collected source data. */
export interface ContextEmail {
    messageId: string;
    subject: string;
    from: string;
    to: string;
    snippet: string;
    receivedAt: string;
    labels: string[];
}
export interface ContextSlackMessage {
    channelId: string;
    channelName: string;
    ts: string;
    userId: string;
    text: string;
    threadTs?: string;
}
export interface ContextSlackChannel {
    channelId: string;
    channelName: string;
    messages: ContextSlackMessage[];
}
export interface ContextCalendarEvent {
    id: string;
    summary: string;
    description?: string;
    location?: string;
    start: string;
    end: string;
    attendees: Array<{
        email: string;
        displayName?: string;
        responseStatus?: string;
    }>;
    meetLink?: string;
    allDay: boolean;
    /** Google Calendar series ID for recurring events. All occurrences of the same
     *  meeting share this ID, enabling the worklog binding to persist across occurrences. */
    recurringEventId?: string;
}
export interface ContextData {
    /** Unread Gmail messages from today. */
    gmail: {
        emails: ContextEmail[];
        error?: string;
    };
    /** Unread Slack messages from today. */
    slack: {
        channels: ContextSlackChannel[];
        error?: string;
    };
    /** Google Calendar events for today + tomorrow. */
    calendar: {
        events: ContextCalendarEvent[];
        error?: string;
    };
    /** Jira logged hours today. */
    jira: {
        hoursToday: number;
        error?: string;
    };
    /** Clockify logged hours today. */
    clockify: {
        hoursToday: number;
        error?: string;
    };
    /** ISO timestamp of when this data was fetched. */
    fetchedAt: string;
}
export interface ContextResponse {
    success: true;
    data: ContextData;
}
//# sourceMappingURL=context.d.ts.map