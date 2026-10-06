# Document review proposals

Google Docs comment notifications received through Gmail can be represented as a
proposal with `kind: "DOCUMENT_REVIEW"`. The proposal keeps `system: "gmail"`,
contains a trusted Google Docs URL, and exposes `sourceMessageIds` with only the
notifications relevant to the authenticated Gmail account. It does not contain
an email reply draft.

`POST /api/v1/proposals/:id/resolve-document-review` explicitly resolves this
proposal. The backend verifies ownership and proposal kind, marks all included
Gmail messages as read with one bounded batch operation, changes the proposal
status to `READ`, and writes an audit event. Opening the document URL has no
server-side effect. The regular proposal approval endpoint rejects document
review proposals and therefore cannot send a reply to a Google notification
address.

Houston NextGen – API Contracts
1. API Principles

The API must be:

REST-first,
strongly typed,
versioned,
auditable,
backward compatible.
2. API Versioning
/api/v1
3. Authentication

Use:

Authorization: Bearer <token>
4. Standard Response
Success
{
  "success": true,
  "data": {}
}
Error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input"
  }
}
5. Agent APIs
GET /api/v1/agents

Returns all visible agents.

POST /api/v1/agents

Creates new agent.

Request
{
  "name": "Inbox Assistant",
  "description": "Handles inbox proposals",
  "autonomyLevel": 1
}
PUT /api/v1/agents/:id

Updates agent.

DELETE /api/v1/agents/:id

Archives agent.

6. Proposal APIs
GET /api/v1/proposals

Returns proposals.

POST /api/v1/proposals/:id/approve

Approves proposal.

POST /api/v1/proposals/:id/reject

Rejects proposal.

POST /api/v1/proposals/from-source-message

Creates a pending `MESSAGE_REPLY` proposal only after the user explicitly
selects **Vytvořit proposal** for a Gmail or Slack preview message. The desktop
must send identifiers only; it must not send the message content.

Gmail request:
```json
{ "source": "gmail", "messageId": "gmail-message-id" }
```

Slack request:
```json
{ "source": "slack", "channelId": "C123", "ts": "1700000000.100000" }
```

The backend authenticates the user, reloads the requested message through that
user's connector, and returns `201` with the full created proposal. It stores
all available source metadata and a message snapshot, but performs no LLM call,
sends no reply, and does not mark the source message read. Repeating a request
for the same pending source message returns the existing proposal. Later draft
generation remains available through `POST /api/v1/proposals/:id/regenerate-draft`.

7. Connector APIs
GET /api/v1/connectors

Returns connector status.

POST /api/v1/connectors/:type/connect

Starts OAuth flow.

POST /api/v1/connectors/:type/disconnect

Disconnects connector.

8. Audit APIs
GET /api/v1/audit

Returns audit events.

Supports:

pagination,
filtering,
export.
9. Worklog APIs
GET /api/v1/worklogs/missing

Returns suggested missing worklogs.

POST /api/v1/worklogs

Creates Jira worklog.

10. Streaming APIs
GET /api/v1/scan/stream

SSE endpoint.

Event Types
progress,
log,
proposal,
completed,
error.

The `completed` event contains a diagnostic summary suitable for direct UI
rendering. Counts contain no message content or connector credentials.

```json
{
  "type": "completed",
  "scanRunId": "scan-id",
  "summary": {
    "tierCounts": { "1": 4, "2": 3, "3": 20 },
    "totalItems": 27,
    "proposalCount": 2,
    "proposalCountsBySource": { "gmail": 1, "slack": 1 },
    "deduplicatedCount": 5,
    "relevanceFilteredCount": 2,
    "relevanceRejected": { "not_addressed": 2 },
    "sourceErrors": {},
    "sources": { "gmail": 30, "slack": 50, "calendar": 4 }
  }
}
```

`proposalCount` counts proposals successfully persisted by this scan.
`deduplicatedCount` includes items merged into or covered by an existing
pending proposal and duplicate topics within the current scan.
`relevanceFilteredCount` counts actionable AI classifications rejected by the
deterministic relevance policy. `sourceErrors` contains per-connector errors
without message content. The same fields are returned in the completed
`GET /api/v1/scan/status` snapshot. Older stored scans may omit the extended
fields.

GET /api/v1/scan/status

Returns the latest scan for the authenticated user. The endpoint does not accept a user identifier.

Response
{
  "scan": {
    "scanRunId": "scan-id",
    "status": "RUNNING",
    "phase": "fetch",
    "message": "Fetching data from all connected sources...",
    "startedAt": "2026-09-01T08:00:00.000Z",
    "completedAt": null,
    "summary": null,
    "proposals": []
  }
}

`scan` is `null` when the authenticated user has no previous scan. Desktop clients use this endpoint after a reload and poll while `status` is `RUNNING`; it is a progress snapshot and does not replay historical SSE logs.
11. Validation

All APIs must:

validate DTOs,
validate permissions,
validate policies,
log audit events.
12. Forbidden Patterns

Never:

expose internal DB schema,
expose secrets,
expose raw connector tokens,
bypass approvals.