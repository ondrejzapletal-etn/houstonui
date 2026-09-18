Houston NextGen – System Architecture
1. Purpose

Houston NextGen is a secure AI-first cross-platform desktop application focused on:

unified productivity workflows,
AI-assisted communication handling,
worklog orchestration,
contextual knowledge aggregation,
secure execution of AI agents.

The system integrates:

Gmail,
Slack,
Calendar,
Jira,
Clockify,
Knowledge Graph,
future enterprise connectors.

The architecture prioritizes:

security,
maintainability,
auditability,
GDPR compliance,
extensibility,
low operational risk.
2. Architectural Principles
2.1 Thin Desktop Client

Desktop application must:

render UI,
manage local state,
display proposals,
display logs,
handle user interactions.

Desktop application must NOT:

store secrets,
directly call Azure OpenAI,
store OAuth refresh tokens,
execute autonomous agents,
directly communicate with enterprise connectors.
2.2 Backend-Centric Security

All sensitive operations are backend mediated.

Backend responsibilities:

authentication,
authorization,
policy enforcement,
audit logging,
connector orchestration,
AI gateway,
approval workflows,
agent runtime,
secret management.
2.3 Zero Trust Architecture

Every action must be:

authenticated,
authorized,
auditable,
policy validated.

No implicit trust exists between:

desktop and backend,
agents and connectors,
users and tools.
3. High-Level Architecture
┌────────────────────────────┐
│ Desktop App (Electrobun)  │
│ React + TypeScript        │
└─────────────┬──────────────┘
              │ HTTPS / WebSocket
              ▼
┌────────────────────────────┐
│ Backend API               │
│ NestJS                    │
└───────┬──────────┬─────────┘
        │          │
        ▼          ▼
 AI Gateway     Agent Runtime
        │          │
        └────┬─────┘
             ▼
      Azure OpenAI


             ▼
      Connector Layer


 Gmail | Slack | Jira | Calendar | Clockify


             ▼
         PostgreSQL


             ▼
        Audit Storage
4. Desktop Architecture
4.1 Technology Stack
Area	Technology
Runtime	Electrobun
UI	React
Language	TypeScript
Styling	TailwindCSS
State	Zustand
Server State	TanStack Query
Validation	Zod
Forms	React Hook Form
Testing	Vitest + Playwright
4.2 Desktop Responsibilities
Allowed
render UI,
store UI preferences,
local encrypted cache,
optimistic UI,
local drafts.
Forbidden
secrets,
direct LLM access,
direct connector access,
autonomous execution.
5. Backend Architecture
5.1 Technology Stack
Area	Technology
Runtime	Node.js LTS
Framework	NestJS
ORM	Prisma
Database	PostgreSQL
Queue	Azure Service Bus
Validation	class-validator + Zod
Auth	OAuth 2.1 / OIDC
API	REST + SSE
5.2 Backend Modules
/apps/backend/src


/modules
  /auth
  /agents
  /approvals
  /audit
  /connectors
  /gmail
  /slack
  /calendar
  /jira
  /clockify
  /ai
  /policies
  /proposals
  /worklogs
  /users
6. AI Architecture
6.1 AI Gateway

All LLM access must go through AI Gateway.

Responsibilities:

model routing,
token accounting,
prompt validation,
PII filtering,
retry handling,
response validation,
audit logging,
fallback models.
6.2 Supported AI Tasks
Task	Model
orchestration	GPT-4.1
drafting	GPT-4.1-mini
classification	GPT-4.1-mini
summarization	GPT-4.1-mini
embeddings	text-embedding-3-large
7. Agent Runtime
7.1 Core Principle

Agents are controlled execution entities.

Agents are NOT prompts.

Each agent has:

permissions,
policies,
audit rules,
autonomy level,
allowed connectors,
approval requirements.
7.2 Execution Flow
User action
  ↓
Policy validation
  ↓
Agent execution request
  ↓
Tool authorization
  ↓
Connector access
  ↓
Proposal generation
  ↓
Approval workflow
  ↓
Execution
  ↓
Audit log
8. Event-Driven Architecture
8.1 Events

Examples:

proposal.created
proposal.dismissed
approval.requested
approval.accepted
approval.rejected
connector.failed
agent.completed
audit.security_incident
8.2 Event Transport

Recommended:

Azure Service Bus.
9. Storage Architecture
9.1 Primary Storage

PostgreSQL:

users,
proposals,
approvals,
agent definitions,
audit logs,
policies,
connector metadata.
9.2 Local Storage

Desktop local storage allowed only for:

theme,
UI preferences,
encrypted cache,
temporary drafts.

Never:

refresh tokens,
API secrets,
audit data.
10. Deployment Architecture
10.1 Environments
Environment	Purpose
local	development
dev	integration
staging	validation
production	production
10.2 CI/CD
GitHub Actions
  ↓
Build
  ↓
Tests
  ↓
Security Scan
  ↓
Artifact Signing
  ↓
Deployment
11. Cross-Platform Support
11.1 Supported Platforms
Platform	Support
macOS	full
Windows	full
Linux	supported
11.2 Update Mechanism

Requirements:

signed updates,
staged rollout,
rollback support,
immutable releases.
12. Observability
12.1 Logging

Structured logs only.

Required:

correlation IDs,
user IDs,
request IDs,
agent IDs,
audit event IDs.
12.2 Monitoring

Use:

OpenTelemetry,
Azure Monitor,
Application Insights.
13. Non-Functional Requirements
Area	Requirement
Availability	99.9%
Security	zero-trust
Compliance	GDPR
Auditability	full
Scalability	horizontal
Maintainability	modular architecture
Testability	mandatory automated tests
14. Forbidden Patterns

Never:

direct OpenAI calls from desktop,
secrets in frontend,
shared admin accounts,
full-access agents,
implicit permissions,
direct DB edits from UI,
hidden background automation.