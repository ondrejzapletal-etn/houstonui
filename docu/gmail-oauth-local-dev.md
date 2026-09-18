# Gmail OAuth – Local Development Guide

This document describes how to connect Gmail locally without a production Azure setup or authenticated user session.

---

## Overview

The Gmail OAuth flow in Houston NextGen normally requires:

1. A signed-in user (JWT from Azure Entra ID)
2. Azure Key Vault for token storage

Neither is available during early local development. The codebase includes a set of **dev-only accommodations** that bypass these requirements when `NODE_ENV=development`.

---

## Prerequisites

### 1. Google Cloud Console – OAuth 2.0 Client

Create an OAuth 2.0 client of type **Web application** (not Desktop):

1. Go to **APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth client ID**
2. Select **Web application**
3. Under **Authorized redirect URIs** add:
   ```
   http://localhost:3000/api/v1/connectors/gmail/callback
   ```
4. Save – note the **Client ID** and **Client Secret**

### 2. Google Cloud Console – Gmail API

Enable the Gmail API:

1. Go to **APIs & Services → Library → Gmail API → Enable**
2. On the **OAuth consent screen**, add scope: `https://www.googleapis.com/auth/gmail.readonly`

### 3. Backend `.env`

```env
NODE_ENV=development

GMAIL_CLIENT_ID=<your-web-client-id>
GMAIL_CLIENT_SECRET=<your-client-secret>
# Optional – defaults to http://localhost:3000/api/v1/connectors/gmail/callback
# GMAIL_REDIRECT_URI=http://localhost:3000/api/v1/connectors/gmail/callback

# AZURE_KEYVAULT_URL is optional in development.
# env.validation.ts automatically injects a fake URL when NODE_ENV=development
# and the variable is missing or invalid. Tokens are stored in memory instead.
# AZURE_KEYVAULT_URL=http://localhost/dev-fake-keyvault/
```

### 4. Database – dev user seed

The connector credential is stored under a placeholder userId. Seed it once:

```powershell
cd apps/backend
@"
INSERT INTO users (id, "entraId", email, "displayName", "createdAt", "updatedAt")
VALUES ('dev-user-placeholder', 'dev-entra-placeholder', 'dev@localhost', 'Dev User', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
"@ | npx prisma db execute --stdin
```

---

## Starting the Stack

```powershell
# Terminal 1 – Backend
$env:NODE_ENV="development"; pnpm dev:backend

# Terminal 2 – Desktop
pnpm dev:desktop
```

---

## Connecting Gmail

1. Open the desktop app at `http://localhost:5173`
2. In the **Sources** section, click **Připojit Gmail** (the yellow dev button)
3. A browser window opens – authorise the Houston2 app
4. The browser tab closes automatically and returns to Houston
5. After ~3 seconds the Sources section refreshes and shows the unread count badge

---

## How It Works

### Backend dev accommodations

Three endpoints are decorated with `@Public()` and use `resolveUserId()` to fall back to `dev-user-placeholder` when no JWT is present:

| Endpoint | Normal | Dev fallback |
|---|---|---|
| `GET /api/v1/connectors` | JWT required | `dev-user-placeholder` |
| `POST /api/v1/connectors/:type/connect` | JWT required | `dev-user-placeholder` |
| `POST /api/v1/connectors/:type/refresh-unread` | JWT required | `dev-user-placeholder` |

### Key Vault dev mode

`KeyVaultService` detects `NODE_ENV=development` (and absence of `KEY_VAULT_FORCE_AZURE=true`) and switches to an **in-memory `Map`** instead of Azure Key Vault. Tokens are lost on backend restart.

To force real Azure Key Vault even in development:

```env
KEY_VAULT_FORCE_AZURE=true
```

### Frontend behaviour

- `useConnectors` query is always `enabled: true` (not gated on `accessToken`) so the connector list loads even without a logged-in user
- `fetchConnectors` and `refreshConnectorUnread` in `connectorsClient.ts` omit the `Authorization` header when no token is present, so the backend dev fallback can serve the request
- `API_BASE_URL` falls back to `http://localhost:3000/api/v1` when `VITE_API_BASE_URL` is not set in the Vite environment
- After a successful OAuth, the query cache is invalidated and `refresh-unread` is called automatically so the unread count badge appears without a manual page refresh

### env.validation.ts dev shortcut

`apps/backend/src/config/env.validation.ts` automatically injects a fake `AZURE_KEYVAULT_URL` (`http://localhost/dev-fake-keyvault/`) when `NODE_ENV=development` and the variable is absent or invalid. This means `AZURE_KEYVAULT_URL` does **not** need to be set in `.env` for local development – `KeyVaultService` will detect the fake URL and switch to in-memory mode regardless.

---

## Resetting State

If a credential ends up in an invalid state (e.g. after a token 403), clear it with:

```powershell
cd apps/backend
@"
DELETE FROM connector_credentials WHERE "userId" = 'dev-user-placeholder';
"@ | npx prisma db execute --stdin
```

Restart the backend (clears the in-memory Key Vault store) and retry the OAuth flow.

---

## Security Notes

> ⚠️ All dev accommodations are guarded by `NODE_ENV === 'development'` checks on the backend.
> They MUST NOT be active in any non-development environment.

Files containing dev-only code to audit before production release:

| File | Dev behaviour | Production behaviour |
|---|---|---|
| `apps/backend/src/connectors/connectors.controller.ts` | `@Public()` on 3 endpoints; `resolveUserId()` falls back to `dev-user-placeholder` | All endpoints require JWT; `@Public()` and fallback must be removed |
| `apps/backend/src/connectors/key-vault.service.ts` | In-memory `Map` when `NODE_ENV=development` and `KEY_VAULT_FORCE_AZURE≠true` | Always uses Azure Key Vault via `DefaultAzureCredential` |
| `apps/backend/src/config/env.validation.ts` | Auto-injects fake `AZURE_KEYVAULT_URL` when missing | Requires real `AZURE_KEYVAULT_URL` to pass validation |
| `apps/desktop/src/hooks/useConnectors.ts` | Query `enabled: true` regardless of auth state; `refreshOne` works without token | Should be `enabled: !!accessToken` once auth is implemented |
| `apps/desktop/src/services/connectorsClient.ts` | `fetchConnectors` / `refreshConnectorUnread` send no `Authorization` header when token is absent | Token always present after login; header always sent |
| `apps/desktop/src/components/dashboard/SourcesSection.tsx` | `GmailDevConnectButton` rendered (guarded by `import.meta.env.DEV`) | Component must be removed before production build |
