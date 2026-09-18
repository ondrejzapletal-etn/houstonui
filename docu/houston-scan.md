# Houston Scan

Houston Scan automaticky stahuje data ze všech připojených zdrojů, klasifikuje je pomocí AI a na dashboardu zobrazuje akční návrhy. Jde o implementaci **Autonomy Level 1** – scan navrhuje, člověk rozhoduje.

---

## Architektura

```
Desktop (React)                Backend (NestJS)
──────────────────             ──────────────────────────────────────
ActionsSection                 GET /api/v1/scan/stream  (SSE)
  └─ useScanStream()  ──────►  ScanController
       fetch SSE                └─ ScanService (AsyncGenerator<ScanEvent>)
       parse events                  ├─ ScanFetcherService   – paralelní fetch ze zdrojů
       update state                  ├─ ScanClassifierService – LLM klasifikace
       save to localStorage          └─ PrismaService         – uloží Proposal do DB
```

### SSE tok událostí

| Typ události | Kdy | Obsah |
|---|---|---|
| `progress` | milníky (fetch, classify, save) | `message: string` |
| `log` | po dokončení každého zdroje | `source`, `count`, `message` |
| `proposal` | pro každý Tier 1-2 item | `ScanProposalData` |
| `completed` | konec scanu | `ScanSummary` (counts, tierCounts, sources) |
| `error` | fatální chyba | `message: string` |

---

## Backend moduly

### `ScanFetcherService`
- Volá všechny konektory **paralelně** (`Promise.all`)
- Každý zdroj je obalený `try-catch` → chyba jednoho zdroje nezastaví scan
- Vrací `ScanSourceData` s poli `gmail`, `slack`, `calendar`, `jiraToday`, `clockify`
- Gmail zprávy odeslané připojeným účtem a Slack zprávy od přihlášeného Slack uživatele jsou odfiltrovány v konektoru. Nevstupují do knowledge ingestion, AI promptu ani počtů scanu.
- Gmail scan zahrnuje všechny nepřečtené zprávy kromě spamu, koše a zpráv odeslaných připojeným účtem; není omezen jen na štítek Inbox.
- Slack konektor vyřazuje také kořenové zprávy threadů, jejichž `reply_users` obsahuje připojeného uživatele. V 1:1 DM vyřazuje příchozí zprávy, po kterých uživatel později odpověděl.
- Časová DM heuristika se nepoužívá pro kanály ani skupinové konverzace (MPIM), protože pozdější vlastní zpráva nemusí být odpovědí. Při chybějící identitě nebo neprůkazných datech se zpráva ponechá ve scanu.

### `ScanClassifierService`
- Volá `AiGatewayService.chat()` s `jsonMode: true`, `temperature: 0.1`, `userId`
- Model: rychlý tier zvoleného providera – `claude-haiku-4-5` (Anthropic) nebo `gpt-4o-mini`
  (OpenAI). Providera si uživatel volí v Nastavení → AI model, výchozí je `AI_PROVIDER` v `.env`;
  konkrétní modely přes `ANTHROPIC_MODEL_FAST` / `OPENAI_MODEL`. Viz [ADR-003](../docs/decisions/ADR-003-anthropic-api.md).
- System prompt definuje 5 tierů a výstupní JSON formát
- Validuje každý item ze seznamu (neplatné tiery, neznámé systémy jsou skipnuty)
- Přiřazuje `topicKey` podle konverzačního tématu a požadovaného výsledku. Follow-up zprávy ke stejné akci seskupuje, ale rozdílné akce neslučuje jen kvůli stejné osobě nebo projektu.
- Dostává minimální kontext aktuálních `PENDING` proposals a může označit položku jako již pokrytou pomocí `existingProposalId`.

### `ScanService`
- Orchestruje scan jako `AsyncGenerator<ScanEvent>`
- Tier 1–2 položky ukládá jako `Proposal` do DB (tabulka `proposals`)
- V rámci scanu ukládá nejvýše jeden proposal pro stejný `topicKey`; preferuje nižší tier a poté vyšší confidence.
- Nový proposal nevytvoří, pokud stejné téma již pokrývá vlastní `PENDING` proposal. Po změně jeho stavu může ke stejnému tématu vzniknout nový proposal.
- Pokud Slack konektor zjistí, že uživatel na přesnou zdrojovou zprávu již odpověděl, odpovídající `PENDING` proposal se podmíněně změní na `EXPIRED` a nevstoupí do kontextu klasifikátoru. Ostatní stavy se nepřepisují.
- Databázový částečný unikátní index chrání stejné pravidlo i při souběžných scanech. Historické proposals bez `topicKey` se zpětně neslučují.
- Po dokončení aktualizuje `ScanRun.status = COMPLETED`
- Audituje `scan.started` / `scan.completed` / `scan.failed` a automatické uzavření návrhu jako `proposal.expired` s důvodem `slack_message_answered`.

### `ProposalsService`
- `GET /api/v1/proposals` – seznam návrhů pro přihlášeného uživatele
- `POST /api/v1/proposals/:id/approve` – schválí návrh, pro Gmail odešle odpověď (audit logged)
- `POST /api/v1/proposals/:id/reject` – zamítne návrh (audit logged)

---

## Gmail reply flow

Po kliknutí na **Odpovědět** v ProposalCard proběhne:

```
1. Uživatel upraví text v textarea (defaultně AI draft)
2. Klikne "Odpovědět" → otevře se potvrzovací dialog (Komu, Předmět, náhled textu)
3. Potvrdí → POST /api/v1/proposals/:id/approve  { draft: string }
4. Backend:
   a. getMessageDetails(userId, messageId) → { threadId, rfcMessageId, from, to, subject }
   b. sendReply()  – RFC 2822, threadId, In-Reply-To/References, reply-to-all (from → To, to → CC)
   c. markMessageAsRead()  – removeLabelIds: ["UNREAD"]
   d. proposal.status = APPROVED
5. Frontend: archivovací animace, karta zmizí z dashboardu
```

Pokud Gmail API selže (HTTP chyba), backend vrátí 5xx, proposal **zůstane APPROVED** v DB (status byl nastaven před odesláním), ale karta zůstane viditelná a uživatel může opakovat.

**Re-try:** APPROVED proposals lze znovu "approve" – status se nezmění, ale Gmail send se spustí znovu. Užitečné po re-autorizaci (změna scopů).

### Gmail OAuth scopy

| Scope | Účel |
|---|---|
| `gmail.readonly` | čtení emailů pro scan |
| `gmail.send` | odesílání odpovědí |
| `gmail.modify` | označení jako přečtené (`removeLabelIds: ["UNREAD"]`) |

Po přidání `gmail.send` a `gmail.modify` scopů je nutná **re-autorizace** (Disconnect + Connect v nastavení konektorů), protože Google tokeny vydané bez těchto scopů nelze rozšířit.

### Klíčové soubory

| Soubor | Účel |
|---|---|
| `apps/backend/src/connectors/gmail/gmail.service.ts` | `getMessageDetails`, `sendReply`, `markMessageAsRead` |
| `apps/backend/src/proposals/proposals.service.ts` | Gmail reply logika v `approve()` |
| `apps/desktop/src/components/dashboard/ProposalCard.tsx` | Editovatelný draft + confirm dialog |

---

## Tierování

| Tier | Název | Příklady |
|---|---|---|
| 1 | Action Required | DM, @mention, e-mail s dotazem/požadavkem, žádost o přístup |
| 2 | Important Update | zpráva od externího klienta, admin oznámení, sdílený dokument |
| 3 | FYI / Team Activity | channelová aktivita, CC kopie, interní update |
| 4 | Newsletters | newsletter@, digest@, noreply@ s marketingem |
| 5 | Automated / Noise | GitHub notifikace, CI/CD, kalendářní auto-reply |

**Pouze Tier 1 a 2** generují `Proposal` záznamy v DB a jsou zobrazeny na dashboardu.

---

## Frontend – ActionsSection

Sekce Actions na dashboardu (`apps/desktop/src/components/dashboard/ActionsSection.tsx`):

1. **Tlačítko „Spustit scan"** – zavolá `useScanStream().start()`
2. **Live log panel** – zobrazuje SSE `progress` a `log` události (jen během scanu)
3. **Completion banner** – summary po dokončení
4. **ProposalCard** – každý Tier 1-2 návrh s tlačítky Schválit / Zamítnout / Otevřít

### Persistence výsledků
Po dokončení scanu se výsledky (`proposals + summary + timestamp`) uloží do `localStorage` pod klíčem `houston_last_scan`. Při dalším zobrazení dashboardu jsou viditelné ihned (bez opakování scanu).

Kandidáti Tier 3–5 pro hromadné označení Gmail zpráv jako přečtených se ukládají také do metadat `ScanRun` a vracejí přes `/scan/status`. Tlačítko **Označit přečtené** proto zůstane dostupné i po reloadu nebo obnovení přerušeného SSE spojení.

Soubor `apps/desktop/src/services/scanService.ts` exportuje:
- `useScanStream()` – React hook pro SSE stream
- `loadLastScan()` – načte poslední výsledek z localStorage
- `LastScanResult` – typ `{ proposals, summary, completedAt }`

---

## Lokální vývoj

### Prerekvizity
- Backend běží: `pnpm dev:backend`
- Desktop běží: `pnpm dev:desktop`
- V `apps/backend/.env` je nastaven platný `ANTHROPIC_API_KEY` nebo `OPENAI_API_KEY` (stačí jeden;
  `AI_PROVIDER` určuje výchozího providera)

### Připojení konektorů
1. Jdi na stránku **Nastavení** v aplikaci
2. Připoj Gmail přes OAuth (Google)
3. Připoj Jira přes OAuth (Atlassian)
4. Volitelně: Slack, Calendar (stejný Google OAuth jako Gmail, ale scope `calendar.readonly`)

OAuth tokeny se v dev módu ukládají do `apps/backend/.dev-tokens.json` a **přežívají restart backendu**.

### Spuštění scanu
Na dashboardu klikni **„Spustit scan"** v sekci Actions. Průběh je viditelný v live logu, po dokončení se zobrazí návrhy.

### Troubleshooting

| Symptom | Příčina | Řešení |
|---|---|---|
| `conn-gmail-dev-user-placeholder not found` | Backend se restartoval před tím, než byl konektor připojen | Znovu připoj Gmail v Nastavení |
| `AI classification failed` | Špatný nebo chybějící klíč zvoleného providera | Nastav platný `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` v `apps/backend/.env`, nebo přepni providera v Nastavení → AI model |
| `ANTHROPIC_API_KEY is not set` / `OPENAI_API_KEY is not set` | Uživatel má v Nastavení zvoleného providera, jehož klíč na serveru chybí | Doplň klíč, nebo v Nastavení → AI model přepni na druhého providera |
| `No SLACK credential` | Slack není připojen | Připoj Slack v Nastavení (nebo ignoruj – scan pokračuje bez Slacku) |
| Scan se dokončí s 0 proposals | Tier 1-2 položky nejsou v datech, nebo LLM všechno zařadil do Tier 3-5 | Normální – zkontroluj doručenou poštu nebo Slack |

---

## DB schéma (přidáno pro Scan)

```prisma
model ScanRun {
  id          String     @id @default(cuid())
  userId      String
  status      ScanStatus
  metadata    Json?
  completedAt DateTime?
  createdAt   DateTime   @default(now())
  proposals   Proposal[]
}

model Proposal {
  id         String         @id @default(cuid())
  scanRunId  String
  userId     String
  system     String
  tier       Int
  summary    String
  detail     String?
  draft      String?
  url        String?
  externalId String?
  status     ProposalStatus @default(PENDING)
  confidence Float?
  risk       String?
  topicKey   String?
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt
}
```

---

## Klíčové soubory

| Soubor | Účel |
|---|---|
| `apps/backend/src/scan/scan.service.ts` | Orchestrace, AsyncGenerator |
| `apps/backend/src/scan/scan-fetcher.service.ts` | Paralelní fetch ze zdrojů |
| `apps/backend/src/scan/scan-classifier.service.ts` | LLM klasifikace, system prompt |
| `apps/backend/src/scan/scan.controller.ts` | SSE endpoint |
| `apps/backend/src/scan/dto/scan-event.dto.ts` | Typy SSE událostí |
| `apps/backend/src/scan/scan-agent.definition.ts` | Definice agenta v1 |
| `apps/backend/src/proposals/proposals.service.ts` | CRUD návrhů |
| `apps/desktop/src/services/scanService.ts` | `useScanStream`, `loadLastScan` |
| `apps/desktop/src/components/dashboard/ActionsSection.tsx` | UI sekce Actions |
| `apps/desktop/src/components/dashboard/ProposalCard.tsx` | ProposalCard – editovatelný draft, confirm dialog, reply flow |
| `packages/shared-types/src/scan.ts` | Sdílené typy (DTO) |
| `apps/backend/src/connectors/gmail/gmail.service.ts` | Gmail send/read/details metody |
| `docs/decisions/ADR-001-openai-api.md` | ADR pro volbu OpenAI API |
