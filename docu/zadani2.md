# Houston NextGen – Architektonický návrh aplikace

## 1. Cíl systému

Houston NextGen je bezpečný AI-first desktopový produkt pro osobní produktivitu a orchestraci pracovních toků. Aplikace agreguje komunikaci, kalendáře, worklogy a další pracovní kontext do jednoho prostředí a umožňuje nad nimi provozovat AI asistenty („agenty“).

Systém musí:

- fungovat na Windows, macOS i Linuxu,
- být dlouhodobě udržitelný,
- být enterprise-grade z pohledu bezpečnosti,
- splňovat evropské právní požadavky (GDPR, auditovatelnost, práce s osobními údaji),
- umožnit rozšiřitelnost o nové konektory a agenty,
- umožnit budoucí multi-user / workspace režim.

Zdrojový business popis aplikace obsahuje:

- unified inbox,
- AI orchestrátor („Houston scan“),
- návrhy akcí,
- worklog management,
- integrace Gmail, Slack, Calendar, Jira, Clockify,
- knowledge graph,
- lokální persistentní stav,
- CRUD nad kontextovými daty.

---

# 2. Strategické technologické rozhodnutí

## 2.1 Desktop aplikace

### Doporučení

Použít:

- Electrobun
- React
- TypeScript
- Tailwind
- TanStack Query
- Zustand

### Důvod

Electrobun umožňuje:

- nativní desktopovou aplikaci,
- vysoký výkon,
- malou velikost binárky,
- sdílený frontend stack,
- jednodušší deployment než klasický Electron.

### Cross-platform podpora

Cílové platformy:

| Platforma | Stav |
|---|---|
| macOS | plně podporováno |
| Windows | podporováno |
| Linux | podporováno s omezeními |

Linux buildy doporučeno:

- distribuovat s bundlovaným CEF,
- nepoužívat systémový WebKitGTK.

Build pipeline musí produkovat:

- macOS notarized build,
- Windows signed build,
- Linux AppImage/deb/rpm.

---

# 3. Doporučená high-level architektura

## 3.1 Architektonický princip

Desktop aplikace NESMÍ být „chytrý backend v klientovi“.

Desktop klient musí být:

- tenký,
- bezpečný,
- bez secrets,
- bez přímého přístupu k Azure/OpenAI klíčům,
- bez přímého přístupu k OAuth refresh tokenům.

## 3.2 Doporučené rozdělení

```text
┌──────────────────────────┐
│ Desktop app (Electrobun)│
│ React + TS UI           │
└────────────┬─────────────┘
             │ HTTPS/WebSocket
             ▼
┌──────────────────────────┐
│ Backend API              │
│ Azure App Service        │
└────────────┬─────────────┘
             │
   ┌─────────┼─────────┐
   ▼         ▼         ▼
Azure OpenAI PostgreSQL Storage
```

## 3.3 Backend responsibilities

Backend musí řešit:

- autentizaci,
- autorizaci,
- správu OAuth tokenů,
- orchestraci agentů,
- audit,
- policy enforcement,
- komunikaci s Azure OpenAI,
- práci s konektory,
- bezpečnostní validace,
- logging,
- rate limiting.

Desktop klient:

- renderuje UI,
- zobrazuje návrhy,
- zobrazuje logy,
- sbírá uživatelské akce,
- lokálně cacheuje necitlivá data.

---

# 4. Doporučený backend stack

## 4.1 Backend runtime

### Doporučení

- TypeScript
- NestJS
- Node.js LTS

### Důvod

NestJS:

- enterprise architektura,
- DI container,
- modulární architektura,
- CQRS support,
- guardy,
- testovatelnost,
- výborná maintainability.

---

# 5. Azure architektura

## 5.1 Doporučené Azure služby

| Oblast | Azure služba |
|---|---|
| Backend | Azure App Service |
| API Gateway | Azure API Management |
| LLM | Azure OpenAI |
| Secrets | Azure Key Vault |
| DB | Azure PostgreSQL Flexible Server |
| Fronta | Azure Service Bus |
| Soubory | Azure Blob Storage |
| Monitoring | Azure Monitor + Application Insights |
| Identity | Microsoft Entra ID |
| SIEM | Microsoft Sentinel |
| CDN + edge | Azure Front Door |

---

# 6. AI architektura

## 6.1 LLM vrstva

LLM modely nesmí být volány z desktopu.

Správný model:

```text
Desktop
  → Backend
      → AI Gateway
          → Azure OpenAI
```

## 6.2 AI Gateway

Doporučená interní komponenta:

```text
AI Gateway
- routing modelů
- rate limiting
- token accounting
- prompt sanitization
- PII filtering
- audit log
- retry policy
- fallback modely
```

## 6.3 Doporučené modely

| Use case | Model |
|---|---|
| orchestrace | GPT-4.1 |
| drafting | GPT-4.1-mini |
| embeddings | text-embedding-3-large |
| klasifikace | GPT-4.1-mini |
| summarizace | GPT-4.1-mini |

---

# 7. Agent architecture

## 7.1 Kritické rozhodnutí

Agent NESMÍ být jen prompt.

Agent musí být bezpečně řízená entita.

## 7.2 Navržený model

```text
Agent
- id
- name
- description
- owner
- allowed_sources
- allowed_tools
- autonomy_level
- approval_rules
- retention_policy
- audit_policy
- state
```

## 7.3 Úrovně autonomie

| Level | Chování |
|---|---|
| 0 | pouze analýza |
| 1 | návrhy akcí |
| 2 | low-risk automatické akce |
| 3 | citlivé automatické akce |

Doporučení:

- v1 → pouze Level 0–1,
- Level 2 pouze opt-in,
- Level 3 nedoporučeno.

---

# 8. User-defined agents

## 8.1 Podpora vlastních agentů

Ano, aplikace má podporovat vytváření vlastních agentů.

Ale:

- nesmí existovat „full access agent“,
- uživatel nesmí mít možnost obejít policy engine,
- každý agent musí mít explicitní oprávnění.

## 8.2 Příklad bezpečného agenta

```text
Agent: Missing Worklog Assistant

Can read:
- Calendar
- Jira
- Clockify

Cannot read:
- Gmail
- Slack

Can suggest:
- Jira worklogs

Cannot execute automatically:
- send message
- archive emails
```

## 8.3 Agent runtime

Agenti musí běžet server-side.

Nikdy:

- v desktop klientovi,
- v renderer procesu,
- s lokálními OAuth tokeny.

---

# 9. Administrace aplikace

## 9.1 Control Center

Administrace nemá být klasický „admin panel“, ale:

```text
Control Center
```

## 9.2 Role

| Role | Odpovědnost |
|---|---|
| User | vlastní agenti a zdroje |
| Workspace Admin | policies, konektory, šablony |
| System Admin | provoz, monitoring, incidenty |

## 9.3 Doporučené sekce administrace

### Agents

- seznam agentů,
- enable/disable,
- test run,
- historie běhů,
- konfigurace,
- schvalovací workflow.

### Permissions

- které zdroje agent smí číst,
- které akce smí vykonat,
- které akce vyžadují approval.

### Connectors

- OAuth status,
- scopes,
- expirace,
- reconnect.

### Approvals

- pending actions,
- kdo schválil,
- audit.

### Audit log

- co agent četl,
- jaký model použil,
- jaké akce navrhl,
- jaké akce provedl.

### Policies

- retention,
- compliance,
- allowed models,
- zakázané akce.

---

# 10. Bezpečnostní architektura

## 10.1 Základní pravidla

### Nikdy neukládat secrets do desktopu

Desktop:

- nesmí obsahovat API keys,
- nesmí obsahovat OpenAI keys,
- nesmí obsahovat OAuth refresh tokeny.

## 10.2 Doporučená autentizace

### OAuth 2.1 + PKCE

Použít:

- system browser login,
- PKCE,
- backend token exchange.

Nedoporučeno:

- embedded browser login,
- custom URL scheme jako jediný callback mechanismus.

## 10.3 Data encryption

| Vrstva | Doporučení |
|---|---|
| transport | TLS 1.3 |
| DB | encryption at rest |
| secrets | Key Vault |
| lokální cache | encrypted storage |
| backupy | encrypted |

---

# 11. GDPR a evropské právo

## 11.1 Kritické požadavky

Systém pracuje s:

- e-maily,
- kalendáři,
- osobními údaji,
- Slack komunikací,
- pracovním výkonem,
- knowledge graphy lidí.

To znamená vysoké GDPR riziko.

## 11.2 Povinnosti

Nutné:

- DPIA,
- audit logging,
- retention policies,
- právo na výmaz,
- export dat,
- transparentní consent,
- evidence zpracování.

## 11.3 Doporučení pro Azure regiony

Používat:

- EU regiony,
- EU Azure OpenAI deploymenty,
- zákaz cross-region replication mimo EU.

---

# 12. Databázová architektura

## 12.1 Doporučení

### Primární DB

PostgreSQL.

### Lokální DB

SQLite pouze:

- cache,
- offline data,
- necitlivá metadata.

## 12.2 Nedoporučeno

Nedoporučeno:

- přímý CRUD nad interními DB tabulkami z UI,
- manuální editace interních YAML souborů,
- append-only audit bez governance.

---

# 13. Event-driven architektura

## 13.1 Doporučení

Používat event bus:

- agent completed,
- proposal created,
- approval requested,
- approval accepted,
- connector failed,
- security incident.

Doporučeno:

- Azure Service Bus.

---

# 14. Update mechanismus

## 14.1 Desktop updates

Použít:

- signed updates,
- staged rollout,
- rollback support,
- immutable artifacts.

## 14.2 Build pipeline

CI/CD:

```text
GitHub Actions
→ build per OS
→ signing
→ notarization
→ artifact upload
→ update manifest publish
```

## 14.3 Release kanály

| Channel | Účel |
|---|---|
| dev | interní testování |
| canary | omezený rollout |
| stable | produkce |

---

# 15. Observability

## 15.1 Povinné telemetry

- audit log,
- agent execution trace,
- prompt trace,
- token consumption,
- connector latency,
- error rate,
- security incidents.

## 15.2 Monitoring

Použít:

- OpenTelemetry,
- Azure Monitor,
- Application Insights,
- structured logs.

---

# 16. Doporučená struktura monorepa

```text
/apps
  /desktop
  /backend
  /admin

/packages
  /ui
  /api-client
  /auth
  /agents
  /connectors
  /policies
  /shared-types

/infrastructure
  /terraform
  /bicep
  /docker
```

---

# 17. Doporučené MVP pořadí

## Fáze 1

- login,
- Gmail,
- Calendar,
- unified inbox,
- AI proposals,
- approval workflow.

## Fáze 2

- Jira,
- worklog suggestions,
- Slack,
- audit logs.

## Fáze 3

- user-defined agents,
- policy engine,
- workspace mode.

## Fáze 4

- marketplace agentů,
- týmová spolupráce,
- multi-tenant enterprise features.

---

# 18. Klíčová doporučení

## Dělat

- thin desktop client,
- backend-centric security,
- Azure OpenAI přes gateway,
- explicitní permissions,
- approval workflows,
- audit everything,
- EU-only processing,
- signed updates,
- zero trust architektura.

## Nedělat

- přímé OpenAI volání z desktopu,
- OAuth tokeny v klientovi,
- neauditovatelné agenty,
- full-access automatizace,
- embedded browser auth,
- přímé CRUD nad interní DB z UI.

---

# 19. Finální doporučení

Doporučená cílová architektura:

```text
Electrobun desktop shell
    ↓
Secure Backend API
    ↓
AI Gateway
    ↓
Azure OpenAI
```

Agenti:

```text
Server-side
Policy-driven
Auditable
Approval-based
```

Tento model:

- je dlouhodobě udržitelný,
- je enterprise-ready,
- odpovídá GDPR,
- umožňuje budoucí rozšiřování,
- minimalizuje bezpečnostní rizika,
- podporuje cross-platform desktop aplikaci,
- umožňuje bezpečný agentic AI systém.

