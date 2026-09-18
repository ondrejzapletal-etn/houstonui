# Houston NextGen – Agent Instructions

You are working on Houston NextGen, a secure cross-platform desktop AI productivity app.

## Non-negotiable architecture
- Desktop app is a thin Electrobun client.
- No secrets in desktop code.
- No Azure OpenAI calls from desktop.
- All LLM calls go through backend AI Gateway.
- All agent execution is server-side.
- All sensitive actions require approval unless explicitly allowed by policy.
- GDPR, auditability, least privilege and secure defaults are mandatory.

## Stack
- Desktop: Electrobun, React, TypeScript, Tailwind.
- Backend: NestJS, TypeScript.
- DB: PostgreSQL.
- Cloud: Azure App Service, API Management, Key Vault, Azure OpenAI, Service Bus.
- Auth: OAuth 2.1 / OIDC with PKCE.

## Coding rules
- Prefer small modules.
- No business logic in React components.
- No direct connector calls from UI.
- No hardcoded secrets.
- Validate all external input.
- Add tests for every non-trivial change.
- Update docs and ADRs when architecture changes.

## Before implementing
1. Read `/docs/00-product-brief.md`.
2. Read `/docs/01-architecture.md`.
3. Read relevant `.github/instructions/*.instructions.md`.
4. Make a short implementation plan.
5. Implement in small commits.