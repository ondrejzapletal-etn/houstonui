# 06 – Connector Credential Storage

> Status: Implemented · Last updated: 2026-05-07

---

## 1. Overview

Houston stores OAuth credentials for external connectors (Gmail, Slack) using a
**two-layer architecture**:

| Layer                                    | What is stored                              | Why                                   |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------- |
| **Azure Key Vault**                      | Token bytes (`accessToken`, `refreshToken`) | Secrets must never touch the database |
| **PostgreSQL** (`connector_credentials`) | Reference (KV secret name) + metadata       | Queryable status, audit trail, expiry |

No token value is ever written to the database, returned in an API response, or
logged.

---

## 2. Entity Model

```
┌──────────────────────────────────────────────────────────────────┐
│ users                                                            │
│  id (PK)                                                         │
│  email                                                           │
│  entraId                                                         │
└─────────────┬────────────────────────────────────────────────────┘
              │ 1 : N
              ▼
┌──────────────────────────────────────────────────────────────────┐
│ connector_credentials                                            │
│  id                    PK (cuid)                                 │
│  userId                FK → users.id (CASCADE DELETE)            │
│  connectorType         GMAIL | SLACK                             │
│  keyVaultSecretName    "conn-gmail-{userId}"  ◄── KV pointer     │
│  status                ACTIVE | EXPIRED | INVALID | REVOKED      │
│  scopes                string[]  (OAuth scopes granted)          │
│  externalAccountId     e.g. user@gmail.com, Slack user ID        │
│  tokenExpiresAt        DateTime? (access token TTL metadata)     │
│  createdAt / updatedAt                                           │
│                                                                  │
│  UNIQUE (userId, connectorType)                                  │
└──────────────────────────────────────────────────────────────────┘
              │
              │ keyVaultSecretName references
              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Azure Key Vault                                                  │
│  Secret: conn-gmail-{userId}                                     │
│    value: { accessToken, refreshToken, obtainedAt }  (JSON)      │
│  Secret: conn-slack-{userId}                                     │
│    value: { accessToken, refreshToken, obtainedAt }  (JSON)      │
└──────────────────────────────────────────────────────────────────┘
```

### ConnectorStatus state machine

```
                    ┌──────────┐
                    │  ACTIVE  │◄────────────────────────────────┐
                    └────┬─────┘                                 │
       token TTL reached │         (re-authorize)                │
                         ▼                                       │
                    ┌──────────┐                                 │
                    │ EXPIRED  │ ──── user re-authorizes ────────┘
                    └────┬─────┘
    provider rejects  │
    or KV secret gone │
                         ▼
                    ┌──────────┐
                    │ INVALID  │ ──── user re-authorizes ────────┐
                    └──────────┘                                 │
                                                                 │
    user disconnects ──────────────────────────────────────────▼
                    ┌──────────┐
                    │ REVOKED  │  (terminal – token deleted from KV)
                    └──────────┘
```

---

## 3. OAuth Connect Flow

```
Desktop                Backend                Key Vault         Provider OAuth
  │                       │                       │                    │
  │  GET /connectors/     │                       │                    │
  │  gmail/connect        │                       │                    │
  │──────────────────────►│                       │                    │
  │                       │ store PKCE state       │                    │
  │  { authUrl }          │                       │                    │
  │◄──────────────────────│                       │                    │
  │                       │                       │                    │
  │  [user opens browser → provider login]        │                    │
  │                       │                       │                    │
  │  GET /connectors/     │                       │                    │
  │  gmail/callback?code= │                       │                    │
  │──────────────────────►│                       │                    │
  │                       │──── POST /token ──────────────────────────►│
  │                       │◄─── { access_token, refresh_token } ───────│
  │                       │                       │                    │
  │                       │──── setSecret ────────►│                    │
  │                       │    "conn-gmail-{uid}"  │                    │
  │                       │                       │                    │
  │                       │──── upsert DB record ─►│ (metadata only)    │
  │                       │                       │                    │
  │  { connectorType,     │                       │                    │
  │    status: ACTIVE }   │                       │                    │
  │◄──────────────────────│                       │                    │
```

---

## 4. Token Retrieval Flow (internal – agents/connectors)

```
Agent / Connector       ConnectorCredentialsService    KeyVaultService
      │                           │                          │
      │ getTokens(userId, GMAIL)  │                          │
      │──────────────────────────►│                          │
      │                           │ findUnique(userId,GMAIL) │
      │                           │──────────────┐           │
      │                           │◄─────────────┘           │
      │                           │ assertUsable(status)     │
      │                           │  throws if EXPIRED/      │
      │                           │  INVALID/REVOKED         │
      │                           │                          │
      │                           │ getSecret(secretName)    │
      │                           │─────────────────────────►│
      │                           │◄─── JSON payload ────────│
      │                           │                          │
      │ { accessToken,            │                          │
      │   refreshToken }          │                          │
      │◄──────────────────────────│                          │
```

---

## 5. Error Handling

| Exception                     | HTTP status | Trigger                                              |
| ----------------------------- | ----------- | ---------------------------------------------------- |
| `CredentialNotFoundException` | 404         | No DB record / KV secret absent                      |
| `CredentialExpiredException`  | 401         | `status = EXPIRED`                                   |
| `CredentialInvalidException`  | 422         | `status = INVALID or REVOKED`, or KV secret disabled |

Callers that receive `CredentialExpiredException` or `CredentialInvalidException`
should redirect the user through the connect flow to re-authorise.

---

## 6. REST API

All endpoints require a valid JWT (`Authorization: Bearer …`).

| Method   | Path                            | Description                                            |
| -------- | ------------------------------- | ------------------------------------------------------ |
| `GET`    | `/connectors`                   | List all connector metadata for the authenticated user |
| `GET`    | `/connectors/:type`             | Get metadata for one connector (`gmail` \| `slack`)    |
| `POST`   | `/connectors/:type/credentials` | Store / replace OAuth tokens (backend-to-backend)      |
| `DELETE` | `/connectors/:type/credentials` | Revoke connector, delete token from KV                 |

### POST body (`StoreCredentialBody`)

```json
{
  "accessToken": "ya29.…",
  "refreshToken": "1//…",
  "scopes": ["https://mail.google.com/"],
  "externalAccountId": "user@gmail.com",
  "expiresAt": 1893456000
}
```

`expiresAt` is a **Unix timestamp in seconds**.

---

## 7. Key Vault Secret Naming

```
conn-{connectorType.toLowerCase()}-{userId}
```

Examples:

- `conn-gmail-cldxyz123abc`
- `conn-slack-cldxyz123abc`

Rules:

- Deterministic → a second `storeCredential` call overwrites the previous secret version.
- Key Vault secret names allow `[0-9a-zA-Z-]` – safe since `userId` is a cuid.

---

## 8. Security Notes

- Tokens are **write-only from the API perspective** – `GET /connectors/:type` returns
  metadata only, never token values.
- `ConnectorCredentialsController` is protected by the global `JwtAuthGuard`.
- Key Vault access uses `DefaultAzureCredential` (Managed Identity in production,
  `az login` in development). No credentials are hardcoded.
- On soft-delete (KV recoverable delete), the DB record is kept in `REVOKED` state for
  audit purposes.
- GDPR: `DELETE /connectors/:type/credentials` removes the token from KV
  immediately. The `connector_credentials` row is kept (status: REVOKED) for
  audit trail but contains no PII beyond the userId foreign key.

---

## 9. Local Development Setup

1. Install [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)
   and run `az login`.
2. Create a Key Vault in your Azure subscription (West/North Europe):

   ```bash
   az keyvault create \
     --name houston-dev-vault \
     --resource-group houston-dev \
     --location northeurope
   ```

3. Add your object ID to the vault's access policy:

   ```bash
   az keyvault set-policy \
     --name houston-dev-vault \
     --upn your@email.com \
     --secret-permissions get set delete list
   ```

4. Set the env var:

   ```bash
   AZURE_KEYVAULT_URL=https://houston-dev-vault.vault.azure.net/
   ```

---

## 10. Migration

Migration applied: `20260507120441_add_connector_credentials`

Changes:

- Added `ConnectorType` enum (`GMAIL`, `SLACK`)
- Added `ConnectorStatus` enum (`ACTIVE`, `EXPIRED`, `INVALID`, `REVOKED`)
- Added `connector_credentials` table
- Added back-reference column to `users`
