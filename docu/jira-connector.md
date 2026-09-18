# Jira Connector

Dokumentace implementace Jira konektoru v Houston NextGen (backend NestJS + frontend React).

---

## Obsah

1. [Přehled](#přehled)
2. [OAuth 2.0 (3LO) flow](#oauth-20-3lo-flow)
3. [Jak se získávají worklogy](#jak-se-získávají-worklogy)
4. [Dev vs. prod prostředí](#dev-vs-prod-prostředí)
5. [Konfigurace – env proměnné](#konfigurace--env-proměnné)
6. [Atlassian App – potřebná nastavení](#atlassian-app--potřebná-nastavení)
7. [Architektura souborů](#architektura-souborů)
8. [Známá omezení](#známá-omezení)

---

## Přehled

Konektor umožňuje přihlášenému uživateli propojit svůj Jira Cloud účet s Houstonem.
Po propojení Houston agreguje odpracované hodiny (worklogy) uživatele z **libovolného počtu Jira projektů** a zobrazuje je v deníku po dnech.

Uživatel nikdy nesdílí heslo – autentizace probíhá výhradně přes Atlassian OAuth 2.0 (Authorization Code + PKCE).

---

## OAuth 2.0 (3LO) flow

```
Desktop (React)
    │
    │  POST /api/v1/connectors/jira/connect
    ▼
Backend (ConnectorsService.initiateConnect)
    │  1. Vygeneruje code_verifier (PKCE) + code_challenge
    │  2. Uloží pending state (CSRF token, TTL 10 min) do in-memory mapy
    │  3. Sestaví Atlassian authorization URL
    │  4. Vrátí { authUrl } frontendu
    ▼
Desktop
    │  Otevře authUrl v systémovém prohlížeči
    ▼
Atlassian (auth.atlassian.com)
    │  Uživatel povolí přístup
    │  Redirect → GET /api/v1/connectors/jira/callback?code=...&state=...
    ▼
Backend (ConnectorsService.handleCallback)
    │  1. Ověří state (CSRF, single-use)
    │  2. Vymění code za access_token + refresh_token (code + code_verifier)
    │  3. Zavolá GET https://api.atlassian.com/oauth/token/accessible-resources
    │     → získá cloudId (první přístupný Jira site)
    │  4. Zavolá GET https://api.atlassian.com/me → accountId uživatele
    │  5. Uloží tokeny do Key Vault (viz níže)
    │  6. Uloží cloudId (externalAccountId) + accountId do DB (tabulka Connector)
    │  7. Redirect → http://localhost:5173/?jira=connected (dev) / frontend URL (prod)
```

### Obnovení tokenu (Token Refresh)

- **Proaktivní:** Pokud je token do 5 minut od expiry, JiraService ho obnoví ještě před API voláním.
- **Reaktivní:** Pokud Atlassian vrátí `401`, backend provede refresh a zopakuje požadavek.
- **Selhání refreshe:** Credential je označen jako `INVALID` v DB → frontend zobrazí výzvu k opětovnému propojení.

### Použité OAuth scopy

| Scope | Účel |
|---|---|
| `read:jira-work` | Čtení worklogů |
| `write:jira-work` | Zápis worklogů |
| `read:jira-user` | Získání accountId uživatele |
| `offline_access` | Refresh token (nutný pro obnovení) |

---

## Jak se přidává worklog

### Endpoint

```
POST /api/v1/connectors/jira/worklogs
Content-Type: application/json

{
  "issueKey": "PROJ-123",       // regex: ^[A-Z][A-Z0-9_]*-\d+$
  "date": "2026-05-11",         // YYYY-MM-DD
  "timeSpentSeconds": 3600,     // int, min 60
  "comment": "Co jsem dělal"   // optional, max 255 znaků
}
```

**Odpověď (201 Created):**
```json
{ "success": true, "data": { "worklogId": "...", "started": "...", "timeSpentSeconds": 3600 } }
```

### Atlassian API

Houston volá `POST /rest/api/3/issue/{key}/worklog` na Atlassian Cloud.

- Čas se vždy ukládá jako `YYYY-MM-DDT12:00:00.000+0000` (poledne UTC) → datum se nikdy nepřesune do jiného dne bez ohledu na timezone uživatele.
- Komentář musí být v **Atlassian Document Format (ADF)** – plain text se automaticky zabalí:
  ```json
  { "type": "doc", "version": 1, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "..." }] }] }
  ```

### Validace vstupu

`AddWorklogDto` (`add-worklog.dto.ts`) používá `class-validator`:
- `issueKey` – regex `^[A-Z][A-Z0-9_]*-\d+$`
- `date` – regex `^\d{4}-\d{2}-\d{2}$`
- `timeSpentSeconds` – integer, min 60
- `comment` – optional string, max 255

Globální `ValidationPipe` v `main.ts` (whitelist + forbidNonWhitelisted) odmítá neznámá pole.

### Frontend – formulář

`AddWorklogModal.tsx` přijímá lidsky čitelné formáty času:

| Vstup | Sekund |
|---|---|
| `1h 30m` | 5400 |
| `90m` | 5400 |
| `1.5h` | 5400 |
| `3600` | 3600 |

Po úspěšném odeslání se modál automaticky zavře (900 ms prodleva pro zobrazení potvrzení).

---

## Jak se získávají worklogy

Atlassian API `POST /rest/api/3/search/jql` vrací HTTP 410 (deprecated) nebo 400 (nevhodný body).
Implementace proto používá dedikované worklog endpointy, které fungují spolehlivě s dostupnými scopy.

### Algoritmus – dva kroky

```
Krok 1 – GET /rest/api/3/worklog/updated?since=<epoch-ms>
  • Vrátí stránkovaný seznam worklogId všech worklogů aktualizovaných od daného timestampu
  • Timestamp = první den požadovaného měsíce MINUS 30 dní (buffer pro zpětně zadané záznamy)
  • Odpověď: { values: [{worklogId, updatedTime}], since, until, lastPage }
  • Stránkuje se přes `until` dokud lastPage === true

Krok 2 – POST /rest/api/3/worklog/list  (parallel batches of 1000)
  • Bulk-fetch plných detailů worklogů
  • Filtruje se: entry.author.accountId === accountId uživatele
  • Datum se parsuje přímo z řetězce `started` (prvních 10 znaků = "YYYY-MM-DD")
    → vyhnutí se UTC posunu při použití Date() objektu
  • Agreguje se timeSpentSeconds per den v měsíci
```

### Proč 30denní buffer?

Uživatel může zadat worklog pro datum v cílovém měsíci (např. 5. května) s tím, že ho fyzicky vytvoří dříve (např. 30. dubna). `updatedTime` takového záznamu bude 30. dubna.
Bez bufferu by se takový záznam ve výsledcích neobjevil.

### Detekce data bez UTC posunu

Atlassian vrací `started` ve formátu `"2026-05-08T09:00:00.000+0200"`.
Použití `new Date(started).getFullYear()` by datum posunulo do UTC, což by mohlo přiřadit záznam jinému dni.

Správné řešení:
```typescript
const datePart = entry.started.substring(0, 10) // "2026-05-08"
const [year, month, day] = datePart.split('-').map(Number)
```

---

## Dev vs. prod prostředí

| Oblast | **Vývoj (development)** | **Produkce (production)** |
|---|---|---|
| **Key Vault** | In-memory `Map<string, string>` | Azure Key Vault (SDK `SecretClient`) |
| **Tokeny po restartu** | **Ztraceny** – nutné znovu propojit Jira | Perzistentní v Azure Key Vault |
| **Aktivace dev módu** | `NODE_ENV=development` (výchozí) | `NODE_ENV=production` |
| **Přepnutí na real KV v devu** | `KEY_VAULT_FORCE_AZURE=true` v `.env` | N/A |
| **JIRA_REDIRECT_URI** | `http://localhost:3000/api/v1/connectors/jira/callback` | `https://<api-domain>/api/v1/connectors/jira/callback` |
| **Atlassian App callback** | Musí obsahovat localhost URL | Musí obsahovat produkční URL |
| **Frontend redirect po OAuth** | `http://localhost:5173/?jira=connected` | Konfigurovatelná `FRONTEND_URL` env var |
| **CORS** | Povoleno z `http://localhost:5173` | Omezeno na produkční frontend doménu |
| **DB** | Lokální PostgreSQL (`localhost:5432`) | Azure Database for PostgreSQL |
| **Auth guard** | Dev fallback `dev-user-placeholder` pokud chybí JWT | Striktní JWT validace, žádný fallback |
| **Logování** | DEBUG level – cloudId, accountId, počty worklogů | WARN/ERROR – bez citlivých dat |
| **Token debug log** | Pouze connector type (bez URL) | Shodné |

### Spuštění v dev

```powershell
# Zabíjení starého backend procesu na portu 3000
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess -Force -ErrorAction SilentlyContinue

# Backend
cd C:\_work\projects\houston\houston-v2.1
$env:NODE_ENV="development"
pnpm dev:backend

# Frontend (jiný terminál)
pnpm dev:desktop
```

> **Důležité:** Každý restart backendu smaže in-memory tokeny.
> Po každém restartu je nutné znovu kliknout na „Connect Jira" v UI.

### Přepnutí na Azure Key Vault v lokálním devu

```ini
# apps/backend/.env
KEY_VAULT_FORCE_AZURE=true
AZURE_KEYVAULT_URL=https://<your-vault>.vault.azure.net/
```

Vyžaduje lokální Azure přihlášení (`az login`) nebo service principal v `AZURE_CLIENT_*` env vars.

### Produkce – checklist

- [ ] `NODE_ENV=production`
- [ ] `AZURE_KEYVAULT_URL` nastaven
- [ ] `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET` v Azure Key Vault nebo App Service env
- [ ] `JIRA_REDIRECT_URI` nastaven na produkční URL
- [ ] Produkční redirect URI přidána do Atlassian OAuth App (Developer Console)
- [ ] `JWT_SECRET` – silný random string, uložen v Key Vault
- [ ] CORS nastaven pouze na produkční frontend doménu

---

## Konfigurace – env proměnné

Soubor `apps/backend/.env` (nikdy necommitovat do gitu):

```ini
# Atlassian OAuth App credentials
JIRA_CLIENT_ID=<your-atlassian-client-id>
JIRA_CLIENT_SECRET=<your-atlassian-client-secret>

# Musí odpovídat přesně URL registrované v Atlassian Developer Console
JIRA_REDIRECT_URI=http://localhost:3000/api/v1/connectors/jira/callback

# Azure Key Vault (prázdné = in-memory dev store)
AZURE_KEYVAULT_URL=https://houston-dev-kv.vault.azure.net/
# KEY_VAULT_FORCE_AZURE=true  # odkomentovat pro real KV i v devu
```

---

## Atlassian App – potřebná nastavení

1. Přejdi na [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps/)
2. Vytvoř nebo otevři OAuth 2.0 (3LO) app
3. **Authorization → Callback URLs:**
   - Dev: `http://localhost:3000/api/v1/connectors/jira/callback`
   - Prod: `https://<api-domain>/api/v1/connectors/jira/callback`
4. **Permissions → Jira API:**
   - `read:jira-work` (classic scope)
   - `write:jira-work` (classic scope)
   - `read:jira-user` (classic scope)
5. **Authorization → offline_access:** zapnout (refresh token)
6. Zkopírovat **Client ID** a **Secret** do `.env`

---

## Architektura souborů

```
apps/backend/src/connectors/
├── connectors.module.ts              # NestJS DI registrace
├── connectors.controller.ts          # HTTP endpoints (connect, callback, worklogs…)
├── connectors.service.ts             # OAuth flow orchestrace (všechny konektory)
├── connector-credentials.service.ts  # Uložení/čtení tokenů z Key Vault + DB
├── connector-credentials.controller.ts
├── connector-credential.errors.ts    # CredentialNotFoundException, CredentialInvalidException…
├── connector.types.ts                # Sdílené TypeScript typy
├── connector-type.pipe.ts            # Validace ConnectorType z URL parametru
├── key-vault.service.ts              # Wrapper nad Azure Key Vault / in-memory dev store
└── jira/
    ├── jira.service.ts               # Logika čtení + zápisu worklogů
    │                                 #   withJiraAuth<T>() – sdílený helper pro token refresh
    ├── add-worklog.dto.ts            # DTO + class-validator pro POST /jira/worklogs
    └── jira.service.spec.ts          # Unit testy

apps/desktop/src/
├── services/connectorsClient.ts      # API volání na backend (getJiraWorklogs, addJiraWorklog)
├── hooks/
│   ├── useJiraWorklogs.ts            # TanStack Query hook – čtení worklogů
│   └── useAddWorklog.ts             # TanStack Query mutation hook – přidání worklogu
├── components/
│   ├── dashboard/
│   │   ├── WorklogsSection.tsx       # Zobrazení worklogů + tlačítko „+ Vykaž"
│   │   └── AddWorklogModal.tsx       # Modální formulář (issue, datum, čas, popis)
│   └── onboarding/
│       ├── OnboardingWizard.tsx      # 4-krokový wizard (welcome → gmail → jira → success)
│       └── ConnectJiraStep.tsx       # Krok propojení Jira

packages/shared-types/src/
└── connector.ts                      # ConnectorType, JiraWorklogResponse, AddWorklogRequest/Response
```

> Po každé změně `packages/shared-types` je nutné znovu buildovat:
> ```powershell
> pnpm --filter @houston/shared-types build
> ```

---

## Známá omezení

| Omezení | Popis |
|---|---|
| Jeden Jira site | Ukládá se pouze první `accessible-resource` (cloudId). Multi-site není podporováno. |
| 30denní buffer | Zpětně zadané záznamy starší než 30 dní před začátkem měsíce se neobjeví. |
| Velké instance | `GET /worklog/updated` vrátí všechny worklogy ze site (nejen uživatelovy). Na velkých instancích může být počet ID velký – filtrování probíhá až na straně Houstonu. |
| Dev tokeny | In-memory Key Vault = tokeny se ztratí při restartu backendu. |
