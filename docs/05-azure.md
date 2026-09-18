Houston NextGen – Azure Architecture
1. Goals

Azure infrastructure must provide:

secure AI processing,
scalability,
auditability,
EU residency,
enterprise-grade operations.
2. Recommended Services
Area	Service
API	Azure App Service
AI	Azure OpenAI
Gateway	Azure API Management
Secrets	Azure Key Vault
DB	Azure PostgreSQL Flexible Server
Messaging	Azure Service Bus
Monitoring	Azure Monitor
Logging	Application Insights
Identity	Microsoft Entra ID
SIEM	Microsoft Sentinel
CDN	Azure Front Door
Storage	Azure Blob Storage
3. Regional Strategy

Use EU regions only.

Recommended:

Sweden Central,
West Europe,
North Europe.
4. Network Architecture
Internet
  ↓
Azure Front Door
  ↓
API Management
  ↓
App Service
  ↓
Internal Services
5. Azure OpenAI
5.1 Access Pattern
Desktop
  ↓
Backend
  ↓
AI Gateway
  ↓
Azure OpenAI
5.2 Requirements
no direct desktop access,
EU deployments only,
token accounting,
audit logging.
6. Key Vault

All secrets stored in:

Azure Key Vault.

Examples:

OAuth secrets,
connector credentials,
signing keys.
7. PostgreSQL

Primary relational storage.

Stores:

users,
agents,
proposals,
approvals,
audit logs,
policies.
8. Service Bus

Used for:

agent execution,
asynchronous workflows,
retries,
event-driven processing.
9. Monitoring
9.1 Azure Monitor

Track:

latency,
failures,
AI usage,
security incidents.
9.2 Application Insights

Track:

traces,
dependencies,
exceptions,
correlation IDs.
10. Identity

Recommended:

Microsoft Entra ID.

Supports:

OIDC,
enterprise SSO,
MFA,
conditional access.
11. Infrastructure as Code

Recommended:

Terraform.

Alternative:

Bicep.
12. Deployment Strategy
12.1 Environments
dev,
staging,
production.
12.2 CI/CD
GitHub Actions
  ↓
Tests
  ↓
Security Scan
  ↓
Build
  ↓
Deploy
13. Security Recommendations
private networking,
managed identities,
no public DB access,
Key Vault integration,
WAF enabled,
Defender for Cloud.
14. Cost Optimization

Recommended:

autoscaling,
queue-based workloads,
AI token monitoring,
cold storage for archives.
15. Disaster Recovery

Requirements:

automated backups,
point-in-time restore,
infrastructure reproducibility,
rollback strategy.