# Developer Setup Guide

This guide covers everything you need to run Houston NextGen locally.

---

## Prerequisites

| Tool    | Version    | Notes                                         |
| ------- | ---------- | --------------------------------------------- |
| Node.js | LTS 20+    | Use `.nvmrc` — run `nvm use` in the repo root |
| pnpm    | 9+         | Package manager for the monorepo              |
| Git     | any recent | —                                             |

### Install pnpm

```bash
npm install -g pnpm
```

Verify:

```bash
node --version   # v20.x.x or higher
pnpm --version   # 9.x.x or higher
```

---

## Clone & Install

```bash
git clone <repo-url> houston-v2.1
cd houston-v2.1
pnpm install
```

`pnpm install` bootstraps all workspaces (`apps/backend`, `apps/desktop`, `packages/shared-types`) in a single pass.

---

## Running the App

Start the backend and desktop in separate terminals:

**Terminal 1 – Backend**

```bash
pnpm dev:backend
```

Starts the NestJS server with `ts-node` in watch mode.

**Terminal 2 – Desktop**

```bash
pnpm dev:desktop
```

Starts the Electrobun + React dev server via Vite.

---

## Ports

| Service     | URL                     | Notes                                          |
| ----------- | ----------------------- | ---------------------------------------------- |
| Backend API | `http://localhost:3000` | NestJS — all LLM & agent calls go through here |
| Desktop app | `http://localhost:5173` | Vite dev server                                |

---

## Health Check

Once the backend is running, verify it is healthy:

```bash
curl http://localhost:3000/api/v1/health
```

Expected response:

```json
{
  "success": true,
  "data": { "status": "ok", "timestamp": "2026-05-06T...", "version": "0.0.1" }
}
```

---

## Tests

Run all tests across workspaces:

```bash
pnpm test
```

To run tests for a single workspace:

```bash
pnpm --filter @houston/backend test
pnpm --filter @houston/desktop test
```

Tests use Jest (backend) and Vitest (desktop).

---

## Troubleshooting

### `ts-node-esm` vs `ts-node` (historical bug — fixed)

Earlier versions of the backend `dev` script used `ts-node-esm` as the loader, which caused module resolution errors (`ERR_UNKNOWN_FILE_EXTENSION`) on Windows and some Linux environments. This has been fixed — the backend now uses plain `ts-node` with `"module": "CommonJS"` in its `tsconfig.json`. If you are on an older branch and hit this error, make sure your `apps/backend/package.json` `dev` script reads `ts-node src/main.ts` (not `ts-node-esm`).

### pnpm hoisting & `rxjs`

NestJS depends on `rxjs`. Because the monorepo uses `pnpm`'s strict hoisting, `rxjs` **must** be listed as a direct dependency in `apps/backend/package.json` (under `dependencies`, not just as a transitive dep). If you see `Cannot find module 'rxjs'` at runtime, run:

```bash
pnpm --filter @houston/backend add rxjs
```

### Port already in use

```bash
# find and kill the process occupying port 3000
npx kill-port 3000
```

---

## Environment Variables

No environment variables required for local development.
