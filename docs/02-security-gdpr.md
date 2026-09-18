Houston NextGen – Security & GDPR
1. Security Goals

The application processes:

emails,
Slack messages,
calendar events,
worklogs,
organizational context,
personal data,
behavioral data.

Security is therefore a core system requirement.

2. Security Principles
2.1 Secure by Default

All features must:

deny by default,
require explicit permissions,
be fully auditable,
require explicit approval for sensitive actions.
2.2 Least Privilege

Every component receives:

minimum required permissions,
minimum required data,
minimum required scope.
2.3 Zero Trust

No trusted internal actors.

Every:

request,
connector access,
agent execution,
approval action

must be validated.

3. Authentication
3.1 Authentication Standard

Use:

OAuth 2.1,
OpenID Connect,
PKCE.
3.2 Login Flow
Desktop app
  ↓
System browser
  ↓
Identity provider
  ↓
Backend token exchange
  ↓
Session issued
3.3 Forbidden

Never:

embedded browser login,
password login stored by app,
long-lived frontend tokens.
4. Authorization
4.1 RBAC

Roles:

user,
workspace_admin,
system_admin.
4.2 Policy-Based Authorization

Authorization must also validate:

agent permissions,
connector permissions,
tool permissions,
data classifications.
5. Secrets Management
5.1 Storage

All secrets stored in:

Azure Key Vault.
5.2 Forbidden

Never store secrets in:

desktop client,
source code,
localStorage,
GitHub repository,
logs.
6. Encryption
6.1 Transport

Use:

TLS 1.3.
6.2 Data at Rest

Encrypt:

databases,
backups,
queues,
object storage.
6.3 Local Storage

Any local cache must:

be encrypted,
contain minimal data,
support secure wipe.
7. Audit Logging
7.1 Mandatory Audit Events
login,
logout,
failed authentication,
connector access,
agent execution,
approvals,
data export,
policy changes,
administrative actions.
7.2 Audit Properties

Each event must contain:

timestamp,
actor,
action,
target,
correlation ID,
result,
IP/device metadata.
8. AI Security
8.1 AI Gateway

All LLM access must pass through AI Gateway.

Gateway responsibilities:

prompt filtering,
PII detection,
policy enforcement,
token accounting,
audit logging,
response validation.
8.2 Prompt Injection Protection

Mitigations:

instruction hierarchy,
connector isolation,
tool allowlists,
structured outputs,
response validation.
8.3 Forbidden AI Behaviors

Never allow:

unrestricted tool execution,
unrestricted internet access,
self-modifying prompts,
hidden autonomous execution.
9. Connector Security
9.1 OAuth Scope Minimization

Only request required scopes.

Example:

Gmail read-only if writing not required,
Slack channel-scoped permissions.
9.2 Token Storage

Connector refresh tokens:

encrypted,
server-side only,
rotated when possible.
10. GDPR Compliance
10.1 Legal Basis

The system must document:

legal basis for processing,
data categories,
retention periods,
subprocessors.
10.2 Data Subject Rights

The system must support:

export,
deletion,
rectification,
processing transparency.
10.3 DPIA

A formal Data Protection Impact Assessment is required before production launch.

10.4 Data Minimization

Only process:

data required for the feature,
data required for approvals,
data required for audit.
11. Data Retention
11.1 Retention Rules
Data	Retention
audit logs	1–3 years
AI prompts	minimal necessary
connector cache	short-lived
drafts	configurable
11.2 Secure Deletion

Deletion must:

remove active data,
remove cache,
remove backups when retention expires.
12. EU Data Residency
12.1 Regions

Use:

EU Azure regions only.
12.2 Restrictions

Do not:

replicate outside EU,
use non-EU AI deployments,
transfer unnecessary personal data.
13. Secure Development Lifecycle
13.1 Mandatory Controls
code review,
dependency scanning,
SAST,
DAST,
penetration testing,
secret scanning.
13.2 Security Reviews

Required before release:

architecture review,
threat model review,
GDPR review.
14. Incident Response
14.1 Security Incidents

Must support:

detection,
alerting,
containment,
forensic logging.
14.2 Breach Handling

Must support:

breach investigation,
export of audit logs,
GDPR notification workflow.