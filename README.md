# Houston NextGen

Secure AI-first cross-platform desktop productivity app.

---

## Funkce

- **AI pracovní přehled:** agreguje e-maily, Slack, kalendář a pracovní nástroje do jednoho pracovního kontextu a připravuje návrhy akcí ke schválení.
- **Reporty:** v sekci Reporty lze pro období 7, 30 dní, 3, 6 nebo 12 měsíců i vlastní datumový rozsah sledovat spotřebu AI tokenů, odhadované náklady a vývoj v čase.
- **Úspora času:** report rozlišuje úsporu při skenech, zpracování a označování zpráv i vykazování práce. Výsledek je odhad počítaný z počtu akcí a nastavitelných časových koeficientů.
- **Pracovní výkazy:** podporuje práci s Jira worklogy a Clockify.
- **Bezpečné integrace:** Gmail, Slack, Jira, Google Calendar a Clockify se propojují přes backend. Desktop nikdy neukládá OAuth refresh tokeny ani klíče k AI providerům.

---

## Stack

| Layer      | Technology                                                              |
| ---------- | ----------------------------------------------------------------------- |
| Desktop    | Electrobun, React, TypeScript, Tailwind                                 |
| Backend    | NestJS, TypeScript                                                      |
| Database   | PostgreSQL                                                              |
| AI / Cloud | Azure OpenAI, Azure App Service, API Management, Key Vault, Service Bus |

---

## První spuštění

**Požadavky:** Node.js 20+, pnpm 9+, PostgreSQL pro perzistentní data.

```bash
pnpm install
Copy-Item apps/backend/.env.example apps/backend/.env
# Vyplňte JWT_SECRET, ENTRA_CLIENT_ID, ENTRA_TENANT_ID a DATABASE_URL v apps/backend/.env
pnpm dev           # backend: http://localhost:3000, desktop: http://localhost:5173
```

V PowerShellu vytvoří `Copy-Item` lokální konfiguraci z [apps/backend/.env.example](apps/backend/.env.example). Vyplňte v ní povinné hodnoty uvedené výše; pro první lokální start nejsou OAuth údaje konektorů nutné. Příkaz `pnpm dev` pak spustí backend na `http://localhost:3000` a desktopový vývojový server na `http://localhost:5173`. Při lokálním vývoji backend používá náhradní konfiguraci Key Vaultu a AI provideru, ale před produkčním nasazením musí být nastaveny všechny povinné proměnné prostředí a skutečné služby.

Po spuštění otevřete desktopovou aplikaci a projděte onboarding. Zdroje lze připojit hned, nebo tento krok přeskočit a vrátit se k němu později v nastavení.

### Připojení API a zdrojů

| Zdroj                   | Způsob připojení              | Co Houston používá                      |
| ----------------------- | ----------------------------- | --------------------------------------- |
| Gmail a Google Calendar | OAuth v prohlížeči            | Nepřečtené zprávy a kalendářový kontext |
| Slack                   | OAuth v prohlížeči            | Pracovní kontext a návrhy akcí          |
| Jira                    | Atlassian OAuth 2.0 (3LO)     | Issues a worklogy                       |
| Clockify                | API klíč zadaný při připojení | Časové výkazy                           |

OAuth autorizace vždy probíhá u poskytovatele v prohlížeči. Přístupové a obnovovací tokeny zpracovává backend; citlivé hodnoty se neukládají do desktopové aplikace. Pro lokální Jira OAuth nastavte callback `http://localhost:3000/api/v1/connectors/jira/callback` a potřebné údaje aplikace v `apps/backend/.env`. API klíč Clockify zadávejte jen do dialogu Připojit Clockify, nikdy jej nezapisujte do zdrojového kódu ani do README.

### Kde najít reporty

Po provedení AI akcí otevřete v aplikaci **Reporty**. Zvolte přednastavené nebo vlastní období; rozsahy do 30 dnů se zobrazují po dnech, delší po měsících. Report spotřeby zahrnuje vstupní i výstupní tokeny a známé náklady modelů. Report úspory času je transparentně odhadovaný ukazatel, nikoli změřený čas uživatele.

---

## Skripty

| Skript             | Popis                                                 |
| ------------------ | ----------------------------------------------------- |
| `pnpm dev`         | Spustí backend a desktop paralelně                    |
| `pnpm dev:backend` | Spustí NestJS backend ve vývojovém režimu (port 3000) |
| `pnpm dev:desktop` | Spustí Electrobun/React desktop (port 5173)           |
| `pnpm build`       | Sestaví všechny workspace                             |
| `pnpm lint`        | Spustí ESLint ve všech workspaces                     |
| `pnpm test`        | Spustí testy ve všech workspaces                      |
| `pnpm format`      | Spustí Prettier nad TS/TSX/JS/JSON/MD soubory         |

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
