import AppLayout from '../components/layout/AppLayout'
import { useSettingsStore } from '../store/settingsStore'
import type { AgentAutonomyLevel, AppLanguage, AppTheme } from '../store/settingsStore'
import { useAiSettings, useUpdateAiSettings } from '../hooks/useAiSettings'
import type { AiProviderName } from '@houston/shared-types'

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-6 flex flex-col gap-5">
      <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  )
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-gray-200">{label}</span>
        {description && <span className="text-xs text-gray-500">{description}</span>}
      </div>
      <div className="sm:shrink-0">{children}</div>
    </div>
  )
}

// ─── AI provider ──────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<AiProviderName, string> = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic (Claude)',
}

const SELECT_CLASS =
  'rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed'

/**
 * AI provider choice. Unlike the rest of this page it is server state – the
 * backend needs it to route LLM calls, so it lives in Postgres, not localStorage.
 */
function AiSection() {
  const { data, isLoading, error } = useAiSettings()
  const update = useUpdateAiSettings()

  const providers: AiProviderName[] = ['OPENAI', 'ANTHROPIC']
  const available = data?.availableProviders ?? []
  const defaultLabel = data ? PROVIDER_LABELS[data.systemDefault] : '…'

  return (
    <Section title="AI model">
      <Field
        label="API provider"
        description="Určuje, přes které API běží scan, Houston Task i generování návrhů."
      >
        <select
          value={data?.aiProvider ?? ''}
          disabled={isLoading || update.isPending || !data}
          onChange={(e) => update.mutate((e.target.value || null) as AiProviderName | null)}
          className={SELECT_CLASS}
        >
          <option value="">Výchozí nastavení serveru ({defaultLabel})</option>
          {providers.map((p) => (
            <option key={p} value={p} disabled={!available.includes(p)}>
              {PROVIDER_LABELS[p]}
              {available.includes(p) ? '' : ' – chybí API klíč'}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Použité modely" description="Rychlý model pro klasifikaci, silný pro syntézu.">
        <span className="text-xs text-gray-400 font-mono">
          {data?.models.fast ? `${data.models.fast} · ${data.models.high}` : '—'}
        </span>
      </Field>

      {(error || update.error) && (
        <p className="text-xs text-red-400">
          {(update.error ?? error)?.message ?? 'Nastavení se nepodařilo načíst.'}
        </p>
      )}

    </Section>
  )
}

// ─── Agent autonomy level labels ──────────────────────────────────────────────

const AUTONOMY_LABELS: Record<AgentAutonomyLevel, string> = {
  0: '0 – Pouze analýza',
  1: '1 – Návrhy akcí (doporučeno)',
  2: '2 – Automatické low-risk akce (opt-in)',
  3: '3 – Automatické citlivé akce (nedoporučeno)',
}

// ─── SettingsPage ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    recentJiraIssues,
    workingDayHours,
    theme,
    language,
    maxAgentAutonomyLevel,
    notificationsEnabled,
    slackSignature,
    emailSignature,
    clearRecentJiraIssues,
    setWorkingDayHours,
    setTheme,
    setLanguage,
    setMaxAgentAutonomyLevel,
    setSlackSignature,
    setEmailSignature,
    timeSavingsSecondsPerScan,
    timeSavingsSecondsPerMessage,
    timeSavingsSecondsPerAutoRead,
    timeSavingsSecondsPerMarkRead,
    timeSavingsSecondsPerWorklog,
    setTimeSavingsSecondsPerScan,
    setTimeSavingsSecondsPerMessage,
    setTimeSavingsSecondsPerAutoRead,
    setTimeSavingsSecondsPerMarkRead,
    setTimeSavingsSecondsPerWorklog,
  } = useSettingsStore()

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-white">Nastavení</h1>

        {/* ── Worklog ─────────────────────────────────────────────── */}
        <Section title="Worklog">
          <Field
            label="Délka pracovního dne (hodiny)"
            description="Používá se pro barevné prahové hodnoty v tabulce worklogů."
          >
            <input
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={workingDayHours}
              onChange={(e) => setWorkingDayHours(Number(e.target.value))}
              className="w-20 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 text-right focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
          </Field>

          <Field
            label="Nedávné Jira issues"
            description={
              recentJiraIssues.length > 0
                ? `${recentJiraIssues.length} uložených issues`
                : 'Žádné issues ještě nebyly zadány.'
            }
          >
            {recentJiraIssues.length > 0 ? (
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap gap-1 justify-end max-w-xs">
                  {recentJiraIssues.map((item) => (
                    <span
                      key={item.key}
                      className="rounded px-2 py-0.5 text-xs border border-gray-700 bg-gray-800 text-gray-400"
                    >
                      {item.key}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={clearRecentJiraIssues}
                  className="text-xs text-red-400 hover:text-red-300 underline focus:outline-none"
                >
                  Smazat historii
                </button>
              </div>
            ) : (
              <span className="text-xs text-gray-600">—</span>
            )}
          </Field>
        </Section>

        {/* ── Appearance ──────────────────────────────────────────── */}
        <Section title="Vzhled">
          <Field label="Motiv" description="Připravujeme">
            <select
              value={theme}
              disabled
              onChange={(e) => setTheme(e.target.value as AppTheme)}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-600 opacity-50 cursor-not-allowed"
            >
              <option value="dark">Tmavý</option>
              <option value="light">Světlý</option>
            </select>
          </Field>

          <Field label="Jazyk výstupu agenta" description="Ovlivňuje jazyk výstupu pouze pro scan.">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as AppLanguage)}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            >
              <option value="cs">Čeština</option>
              <option value="en">English</option>
            </select>
          </Field>
        </Section>

        {/* ── AI model ────────────────────────────────────────────── */}
        <AiSection />

        {/* ── Agents ──────────────────────────────────────────────── */}
        <Section title="Agenti">
          <Field
            label="Maximální úroveň autonomie"
            description="Připravujeme – správa agentů bude dostupná v příští verzi."
          >
            <select
              value={maxAgentAutonomyLevel}
              disabled
              onChange={(e) =>
                setMaxAgentAutonomyLevel(Number(e.target.value) as AgentAutonomyLevel)
              }
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-600 opacity-50 cursor-not-allowed"
            >
              {(Object.keys(AUTONOMY_LABELS) as unknown as AgentAutonomyLevel[]).map((level) => (
                <option key={level} value={level}>
                  {AUTONOMY_LABELS[level]}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        {/* ── Signatures ──────────────────────────────────────────── */}
        <Section title="Podpisy">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-200">Neformální podpis (Slack)</span>
            <span className="text-xs text-gray-500">Vkládá se do návrhů odpovědí ve Slacku.</span>
            <textarea
              value={slackSignature}
              onChange={(e) => setSlackSignature(e.target.value)}
              rows={3}
              placeholder="např. S pozdravem, Ondřej"
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 resize-none"
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-200">Formální podpis (Gmail)</span>
            <span className="text-xs text-gray-500">Vkládá se do návrhů e-mailových odpovědí.</span>
            <textarea
              value={emailSignature}
              onChange={(e) => setEmailSignature(e.target.value)}
              rows={4}
              placeholder="např. S pozdravem,&#10;Ondřej Zapletal&#10;Etnetera a.s."
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400 resize-none"
            />
          </div>
        </Section>

        {/* ── Úspora času ─────────────────────────────────────────── */}
        <Section title="Úspora času">
          <div className='text-gray-500 text-sm'>V této kartě je možné změnit defaultní hodnoty časové úpory jednotlivých úkonů. Každý z nás má trochu jiný postup, jiné aplikace, můžete si nastavit vlastní hodnoty.</div>
          <Field
            label="Úspora za scan (sekund)"
            description="Odhadovaná úspora za každý provedený scan. Díky scanu máte celkový přehled napříč všemi kanály. To šetří čas, udržuje v kontextu a zvyšuje produktivitu."
          >
            <input
              type="number"
              min={0}
              step={1}
              value={timeSavingsSecondsPerScan}
              onChange={(e) => setTimeSavingsSecondsPerScan(Number(e.target.value))}
              className="w-20 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 text-right focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
          </Field>
          <Field
            label="Úspora za odeslanou zprávu (sekund)"
            description="Odhadovaná úspora za každou zprávu odeslanou přes Houston. Díky Houstonu nemusíte přepínat taby, hledat zprávu, číst, přepínat se mezi aplikacemi. Houston nabídne odpověď, kterou můžete přepsat a odeslat."
          >
            <input
              type="number"
              min={0}
              step={1}
              value={timeSavingsSecondsPerMessage}
              onChange={(e) => setTimeSavingsSecondsPerMessage(Number(e.target.value))}
              className="w-20 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 text-right focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
          </Field>
          <Field
            label="Úspora za automatické přečtení (sekund)"
            description="Odhadovaná úspora za každou zprávu automaticky označenou jako přečtenou (nabízí se po scanu). Drobná úspora, která vychází z toho, že nemusíte opouštět aplikaci a přepínat se mezi konverzacemi."
          >
            <input
              type="number"
              min={0}
              step={1}
              value={timeSavingsSecondsPerAutoRead}
              onChange={(e) => setTimeSavingsSecondsPerAutoRead(Number(e.target.value))}
              className="w-20 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 text-right focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
          </Field>
          <Field
            label="Úspora za ruční označení přečteno (sekund)"
            description="Odhadovaná úspora za každou zprávu označenou ručně jako přečtenou z návrhu, který vzniká po scanu."
          >
            <input
              type="number"
              min={0}
              step={1}
              value={timeSavingsSecondsPerMarkRead}
              onChange={(e) => setTimeSavingsSecondsPerMarkRead(Number(e.target.value))}
              className="w-20 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 text-right focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
          </Field>
          <Field
            label="Úspora za výkaz práce (sekund)"
            description="Odhadovaná úspora za každý vytvořený výkaz práce. Výkazy v houstonu jsou rychlejší a na méně kliků, včetně návrhů na výkazy z vašich událostí a odchozí komunikace."
          >
            <input
              type="number"
              min={0}
              step={1}
              value={timeSavingsSecondsPerWorklog}
              onChange={(e) => setTimeSavingsSecondsPerWorklog(Number(e.target.value))}
              className="w-20 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 text-right focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
          </Field>
        </Section>

        {/* ── Notifications ────────────────────────────────────────── */}
        <Section title="Notifikace">
          <Field label="Povolené notifikace" description="Připravujeme – notifikace budou dostupné v příští verzi.">
            <button
              type="button"
              role="switch"
              disabled
              aria-checked={notificationsEnabled}
              className={[
                'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent opacity-50 cursor-not-allowed',
                notificationsEnabled ? 'bg-yellow-400' : 'bg-gray-700',
              ].join(' ')}
            >
              <span
                className={[
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200',
                  notificationsEnabled ? 'translate-x-5' : 'translate-x-0',
                ].join(' ')}
              />
            </button>
          </Field>
        </Section>
      </div>
    </AppLayout>
  )
}
