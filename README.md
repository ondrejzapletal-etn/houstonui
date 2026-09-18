# Houston NextGen

Secure AI-first cross-platform desktop productivity app.

---

## Stack

| Layer      | Technology                                                              |
| ---------- | ----------------------------------------------------------------------- |
| Desktop    | Electrobun, React, TypeScript, Tailwind                                 |
| Backend    | NestJS, TypeScript                                                      |
| Database   | PostgreSQL                                                              |
| AI / Cloud | Azure OpenAI, Azure App Service, API Management, Key Vault, Service Bus |

---

## run app

```bash
pnpm dev

```

---

## Quick Start

**Prerequisites:** Node.js 20+, pnpm 9+

```bash
pnpm install

pnpm dev           # backend: http://localhost:3000, desktop: http://localhost:5173
```

---

## Scripts

| Script             | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `pnpm dev`         | Start backend and desktop in parallel                |
| `pnpm dev:backend` | Start NestJS backend in development mode (port 3000) |
| `pnpm dev:desktop` | Start Electrobun/React desktop app (port 5173)       |
| `pnpm build`       | Build all workspaces                                 |
| `pnpm lint`        | Run ESLint across all workspaces                     |
| `pnpm test`        | Run tests across all workspaces                      |
| `pnpm format`      | Run Prettier on all TS/TSX/JS/JSON/MD files          |

---

## Project Structure

```
houston-v2.1/
├── apps/
│   ├── backend/          # NestJS API & AI Gateway
│   └── desktop/          # Electrobun + React UI
├── packages/
│   └── shared-types/     # Shared TypeScript types & DTOs
├── docs/                 # Architecture, API contracts, ADRs
└── package.json          # Root workspace scripts
```

### `apps/desktop`

Thin Electrobun client — renders UI, manages local state, displays AI proposals and logs. No secrets, no direct LLM calls.

### `apps/backend`

NestJS service — AI Gateway, connector orchestration, agent execution, auth, audit logging. All sensitive operations live here.

### `packages/shared-types`

TypeScript types and DTOs shared between desktop and backend. Zero runtime dependencies.

---

## Docs

| Document                                             | Description                                            |
| ---------------------------------------------------- | ------------------------------------------------------ |
| [docs/00-product-brief.md](docs/00-product-brief.md) | Product vision, goals and key use-cases                |
| [docs/01-architecture.md](docs/01-architecture.md)   | System architecture, principles and component overview |
| [docs/10-dev-setup.md](docs/10-dev-setup.md)         | Local development setup and troubleshooting guide      |
