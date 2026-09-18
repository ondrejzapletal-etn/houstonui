# ADR-002: User-Specific Domain Model in PostgreSQL (Client, Project, JiraIssue, CalendarEventIssueLink)

- **Date:** 2026-05-13
- **Status:** Accepted
- **Deciders:** Houston team

## Context

Houston NextGen supports worklog reporting against Jira issues. Users need to:

1. Associate calendar events with Jira issues so the issue is pre-filled when logging work.
2. Understand which project (Jira project) and client (business entity) an issue belongs to.
3. Have a locally searchable list of Jira issues for autocomplete without a live Jira API call on every keystroke.

The existing codebase fetches Jira worklogs live from the Jira API and has no local model for
projects, clients, or issues. Three design options were considered:

### Option A — Live Jira API for everything
Fetch projects and issue details from the Jira API on each request. No local state.

**Rejected:** Jira API calls require an active connection, add latency, and have rate limits.
Issue discovery (which issues the user has worked on) requires expensive JQL queries.
Cannot persist user-defined metadata (project manager, client link, custom notes).

### Option B — Sync all Jira issues to DB periodically
Background job pulls all issues from Jira into the local DB, potentially thousands of records.

**Rejected:** Over-engineering for v1. Creates GDPR surface area (storing all issue data
without explicit user action). Complex sync state management.

### Option C — Lazy local cache, populated on first use (chosen)
User-specific entities (`Client`, `Project`, `JiraIssue`, `CalendarEventIssueLink`) are stored
in PostgreSQL, scoped per `userId`. Issues are populated the first time a user assigns one (manual
add, worklog logging, or proposal approval). No background sync.

## Decision

Add four new user-scoped Prisma models to the existing PostgreSQL database:

| Model | Purpose |
|---|---|
| `Client` | Business entity / customer (name, domain) |
| `Project` | Jira project context (name, `jiraProjectKey`, PM email, optional Client) |
| `JiraIssue` | Locally cached Jira issue (issueKey, summary); populated on first use |
| `CalendarEventIssueLink` | Maps a Google Calendar event ID → Jira issue key; powers pre-fill |

**Population triggers for `JiraIssue`:**
- User manually assigns an issue to a calendar event via `AddWorklogModal`.
- User approves a Jira-system `Proposal` whose `externalId` is a valid issue key (auto-populate on approve).
- Direct POST to `/api/v1/issues` (manual add from UI).

**Project auto-resolution:**  
`IssuesService.upsertFromKey()` extracts the project key prefix from the issue key
(e.g. `"PROJ-123"` → `"PROJ"`) and looks up a `Project` with matching `jiraProjectKey`.
This links issues to projects transparently as long as the user has configured the project.

**CalendarEventIssueLink cardinality:** one-to-one (one event → one issue). Sufficient for v1.

## Consequences

### Positive
- Fast autocomplete: `GET /api/v1/issues?search=` queries a small local table, no Jira round-trip.
- Pre-fill UX: opening "log work" on a recurring calendar event immediately shows the last-used issue.
- User-defined metadata (client, PM email) not available from Jira API alone.
- GDPR-compliant: only issues the user has explicitly interacted with are stored. No bulk sync.
- Follows existing architecture: all storage is server-side PostgreSQL, desktop is thin client.

### Negative / Risks
- Cache can become stale if an issue is renamed in Jira. Mitigated by `lastSyncedAt` field and on-demand refresh (future work).
- User must configure `Project` records manually before auto-resolution works.
- No workspace sharing in v1; each user maintains their own issue cache. Acceptable for current single-user scope.

## New API endpoints

| Endpoint | Description |
|---|---|
| `GET/POST /api/v1/clients` | List / create clients |
| `PUT/DELETE /api/v1/clients/:id` | Update / delete client |
| `GET/POST /api/v1/projects` | List / create projects |
| `PUT/DELETE /api/v1/projects/:id` | Update / deactivate project |
| `GET /api/v1/issues?search=&projectId=` | Search local issue cache (autocomplete) |
| `POST /api/v1/issues` | Upsert issue into local cache |
| `DELETE /api/v1/issues/:id` | Remove issue from cache |
| `GET /api/v1/calendar-links/:eventId` | Get saved issue link for a calendar event |
| `PUT /api/v1/calendar-links/:eventId` | Save / update issue link |
| `DELETE /api/v1/calendar-links/:eventId` | Remove issue link |

## Related

- `docs/00-product-brief.md` §12 — database architecture guidance
- `apps/backend/prisma/schema.prisma` — model definitions
- `packages/shared-types/src/project.ts` — shared DTOs
