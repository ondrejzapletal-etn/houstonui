// --- FindOrCreateProject ---
export interface FindOrCreateProjectRequest {
  jiraProjectKey: string
}

export interface FindOrCreateProjectResponse {
  success: boolean
  /** true pokud byl projekt nově vytvořen, false pokud již existoval */
  wasCreated?: boolean
  data?: { project: ProjectDto }
  error?: string
}
// ─── Client ──────────────────────────────────────────────────────────────────

export interface ClientDto {
  id: string
  userId: string
  name: string
  domain?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface CreateClientDto {
  name: string
  domain?: string
  notes?: string
}

export interface UpdateClientDto {
  name?: string
  domain?: string
  notes?: string
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface ProjectDto {
  id: string
  userId: string
  clientId?: string
  name: string
  /** Jira project key, also used as project code (e.g. "PROJ") */
  jiraProjectKey: string
  pmEmail?: string
  notes?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProjectDto {
  clientId?: string
  name: string
  jiraProjectKey: string
  pmEmail?: string
  notes?: string
}

export interface UpdateProjectDto {
  clientId?: string | null
  name?: string
  jiraProjectKey?: string
  pmEmail?: string | null
  notes?: string | null
  active?: boolean
}

// ─── JiraIssue ───────────────────────────────────────────────────────────────

export interface JiraIssueDto {
  id: string
  userId: string
  projectId?: string
  /** Jira issue key, e.g. "PROJ-123" */
  issueKey: string
  /** Cached issue title from Jira */
  summary: string
  lastSyncedAt?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface UpsertJiraIssueDto {
  issueKey: string
  summary: string
  projectId?: string
}

// ─── CalendarEventIssueLink ──────────────────────────────────────────────────

export interface CalendarIssueLinkDto {
  id: string
  calendarEventId: string
  issueKey: string
  jiraIssueId?: string
  projectId?: string
  createdAt: string
  updatedAt: string
}

export interface UpsertCalendarIssueLinkDto {
  issueKey: string
  projectId?: string
  recurringEventId?: string
}
