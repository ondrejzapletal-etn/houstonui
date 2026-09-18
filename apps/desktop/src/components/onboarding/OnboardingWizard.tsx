import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useConnectors, CONNECTORS_QUERY_KEY } from '../../hooks/useConnectors'
import type { ConnectorType } from '@houston/shared-types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ONBOARDING_DONE_KEY = 'houston_onboarding_complete'

function markOnboardingDone() {
  localStorage.setItem(ONBOARDING_DONE_KEY, '1')
}

// ─── Step indicator ───────────────────────────────────────────────────────────

interface StepDotsProps {
  total: number
  current: number
}

function StepDots({ total, current }: StepDotsProps) {
  return (
    <div className="flex gap-2 justify-center" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-2 rounded-full transition-all duration-300 ${
            i === current ? 'w-6 bg-yellow-400' : 'w-2 bg-gray-600'
          }`}
        />
      ))}
    </div>
  )
}

// ─── Step 0 – Welcome ─────────────────────────────────────────────────────────

interface WelcomeStepProps {
  onNext: () => void
  onSkip: () => void
}

function WelcomeStep({ onNext, onSkip }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      {/* Logo placeholder */}
      <div className="w-20 h-20 rounded-2xl bg-yellow-400 flex items-center justify-center shadow-lg shadow-yellow-400/20">
        <span className="text-3xl font-black text-gray-900">H</span>
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-white tracking-tight">
          Vítejte v Houston NextGen
        </h1>
        <p className="text-gray-400 max-w-sm leading-relaxed">
          Váš AI asistent, který spojuje e-maily, kalendář a pracovní nástroje na jednom místě.
          Začneme propojením prvního zdroje.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs pt-2">
        <button
          type="button"
          onClick={onNext}
          className="w-full rounded-lg bg-yellow-400 px-6 py-3 text-sm font-semibold text-gray-900 hover:bg-yellow-300 transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-gray-900"
        >
          Pojďme na to →
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus:underline"
        >
          Přeskočit nastavení
        </button>
      </div>
    </div>
  )
}

// ─── Step 1 – Connect Gmail ───────────────────────────────────────────────────

const IS_DEV = import.meta.env.DEV

interface ConnectGmailStepProps {
  onConnected: () => void
  onSkip: () => void
  connect: (type: ConnectorType) => void
  connectingType: ConnectorType | null
  connectError: string | null
  isWaitingForOAuth: boolean
}

function ConnectGmailStep({
  onConnected: _onConnected,
  onSkip,
  connect,
  connectingType,
  connectError,
  isWaitingForOAuth,
}: ConnectGmailStepProps) {
  const isConnecting = connectingType === 'gmail'

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="text-4xl">📬</div>
        <h2 className="text-2xl font-bold text-white">Připojte Gmail</h2>
        <p className="text-gray-400 text-sm leading-relaxed max-w-sm mx-auto">
          Houston přečte počty nepřečtených zpráv a zobrazí je na dashboardu. Přihlašovací tokeny
          jsou bezpečně uloženy na serveru v Azure Key Vault.
        </p>
      </div>

      {/* Security note */}
      <div className="rounded-lg border border-blue-800/40 bg-blue-900/20 px-4 py-3">
        <p className="text-xs text-blue-300 leading-relaxed">
          <span className="font-semibold">Vaše tokeny zůstávají na serveru.</span> Do desktopové
          aplikace se nikdy nedostanou. Kliknutím se otevře prohlížeč, kde udělíte oprávnění přímo
          Googlu.
        </p>
      </div>

      {/* Dev badge */}
      {IS_DEV && (
        <div className="rounded-md border border-dashed border-yellow-700/50 bg-yellow-950/30 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-600">
            ⚠️ Dev mode – přihlášení není vyžadováno
          </p>
        </div>
      )}

      {/* Error feedback */}
      {connectError && (
        <div role="alert" className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400">
          {connectError}
        </div>
      )}

      {/* Waiting state */}
      {isWaitingForOAuth && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-800/40 bg-yellow-900/20 px-4 py-3">
          <svg className="h-4 w-4 animate-spin text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-xs text-yellow-300">
            Čeká se na dokončení autorizace v prohlížeči…
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => connect('gmail')}
          disabled={isConnecting || isWaitingForOAuth}
          className="w-full rounded-lg bg-yellow-400 px-6 py-3 text-sm font-semibold text-gray-900 hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-gray-900"
        >
          {isConnecting ? 'Otevírám prohlížeč…' : 'Připojit Gmail'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={isConnecting || isWaitingForOAuth}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus:underline disabled:opacity-40"
        >
          Připojit later
        </button>
      </div>
    </div>
  )
}

// ─── Step 2 – Connect Jira ───────────────────────────────────────────────────

interface ConnectJiraStepProps {
  onSkip: () => void
  connect: (type: ConnectorType) => void
  connectingType: ConnectorType | null
  connectError: string | null
  isWaitingForOAuth: boolean
}

function ConnectJiraStep({
  onSkip,
  connect,
  connectingType,
  connectError,
  isWaitingForOAuth,
}: ConnectJiraStepProps) {
  const isConnecting = connectingType === 'jira'

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="text-4xl">📋</div>
        <h2 className="text-2xl font-bold text-white">Připojte Jira</h2>
        <p className="text-gray-400 text-sm leading-relaxed max-w-sm mx-auto">
          Houston zobrazí vaše výkazy práce (worklogy) v kalendářní tabulce po dnech.
          Přihlašovací tokeny jsou bezpečně uloženy na serveru v Azure Key Vault.
        </p>
      </div>

      {/* Setup note */}
      <div className="rounded-lg border border-blue-800/40 bg-blue-900/20 px-4 py-3 space-y-2">
        <p className="text-xs text-blue-300 font-semibold">Potřebujete Atlassian OAuth app:</p>
        <ol className="text-xs text-blue-200 leading-relaxed list-decimal list-inside space-y-1">
          <li>
            Otevřete{' '}
            <span className="font-mono bg-blue-950/60 px-1 rounded">
              developer.atlassian.com/console/myapps
            </span>
          </li>
          <li>Vytvořte novou app → OAuth 2.0 (3LO)</li>
          <li>
            Permissions:{' '}
            <span className="font-mono bg-blue-950/60 px-1 rounded">read:jira-work</span>,{' '}
            <span className="font-mono bg-blue-950/60 px-1 rounded">write:jira-work</span>,{' '}
            <span className="font-mono bg-blue-950/60 px-1 rounded">read:jira-user</span>,{' '}
            <span className="font-mono bg-blue-950/60 px-1 rounded">offline_access</span>
          </li>
          <li>
            Callback URL:{' '}
            <span className="font-mono bg-blue-950/60 px-1 rounded text-[10px]">
              http://localhost:3000/api/v1/connectors/jira/callback
            </span>
          </li>
          <li>
            Client ID + Secret nastavte v{' '}
            <span className="font-mono bg-blue-950/60 px-1 rounded">apps/backend/.env</span>
          </li>
        </ol>
      </div>

      {/* Dev badge */}
      {IS_DEV && (
        <div className="rounded-md border border-dashed border-yellow-700/50 bg-yellow-950/30 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-600">
            ⚠️ Dev mode – přihlášení není vyžadováno
          </p>
        </div>
      )}

      {/* Error feedback */}
      {connectError && (
        <div role="alert" className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400">
          {connectError}
        </div>
      )}

      {/* Waiting state */}
      {isWaitingForOAuth && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-800/40 bg-yellow-900/20 px-4 py-3">
          <svg className="h-4 w-4 animate-spin text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-xs text-yellow-300">
            Čeká se na dokončení autorizace v prohlížeči…
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => connect('jira')}
          disabled={isConnecting || isWaitingForOAuth}
          className="w-full rounded-lg bg-blue-500 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-gray-900"
        >
          {isConnecting ? 'Otevírám prohlížeč…' : 'Připojit Jira'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={isConnecting || isWaitingForOAuth}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus:underline disabled:opacity-40"
        >
          Přeskočit
        </button>
      </div>
    </div>
  )
}

// ─── Step 3 – Success ─────────────────────────────────────────────────────────

interface SuccessStepProps {
  unreadCount: number | null
  onFinish: () => void
}

function SuccessStep({ unreadCount, onFinish }: SuccessStepProps) {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="w-20 h-20 rounded-full border-4 border-green-400 flex items-center justify-center shadow-lg shadow-green-400/20">
        <svg className="h-10 w-10 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">Gmail připojen!</h2>
        <p className="text-gray-400 text-sm leading-relaxed">
          Houston teď sleduje vaši schránku.
        </p>
        {unreadCount !== null && (
          <p className="text-yellow-400 font-semibold">
            {unreadCount === 0
              ? 'Žádné nepřečtené zprávy – máte čistý stůl 🎉'
              : `${unreadCount} nepřečtených zpráv čeká na pozornost.`}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onFinish}
        className="w-full max-w-xs rounded-lg bg-yellow-400 px-6 py-3 text-sm font-semibold text-gray-900 hover:bg-yellow-300 transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-gray-900"
      >
        Přejít na dashboard →
      </button>
    </div>
  )
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

const STEPS = ['welcome', 'connect-gmail', 'connect-jira', 'success'] as const
type WizardStep = (typeof STEPS)[number]

export default function OnboardingWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { connectors, connect, connectingType, connectError } = useConnectors()

  const [step, setStep] = useState<WizardStep>('welcome')
  const [isWaitingForOAuth, setIsWaitingForOAuth] = useState(false)

  const gmailConnector = connectors.find((c) => c.id === 'gmail') ?? null
  const gmailConnected = gmailConnector?.status === 'connected'
  const jiraConnected = connectors.find((c) => c.id === 'jira')?.status === 'connected'

  // Auto-advance when connector becomes connected
  useEffect(() => {
    if (gmailConnected && step === 'connect-gmail') {
      setIsWaitingForOAuth(false)
      setStep('connect-jira')
    }
  }, [gmailConnected, step])

  useEffect(() => {
    if (jiraConnected && step === 'connect-jira') {
      setIsWaitingForOAuth(false)
      setStep('success')
    }
  }, [jiraConnected, step])

  // When connect is triggered, show waiting state
  useEffect(() => {
    if (connectingType === 'gmail' || connectingType === 'jira') {
      setIsWaitingForOAuth(true)
    }
  }, [connectingType])

  // Poll connector status every 3 s while waiting for OAuth
  useEffect(() => {
    if (!isWaitingForOAuth) return

    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
    }, 3000)

    return () => clearInterval(interval)
  }, [isWaitingForOAuth, queryClient])

  function handleSkip() {
    markOnboardingDone()
    void navigate('/')
  }

  function handleFinish() {
    markOnboardingDone()
    void navigate('/')
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-8 shadow-2xl">
          {/* Step dots */}
          <div className="mb-8">
            <StepDots total={STEPS.length} current={stepIndex} />
          </div>

          {/* Step content */}
          {step === 'welcome' && (
            <WelcomeStep onNext={() => setStep('connect-gmail')} onSkip={handleSkip} />
          )}

          {step === 'connect-gmail' && (
            <ConnectGmailStep
              onConnected={() => setStep('connect-jira')}
              onSkip={() => { setIsWaitingForOAuth(false); setStep('connect-jira') }}
              connect={connect}
              connectingType={connectingType}
              connectError={connectError}
              isWaitingForOAuth={isWaitingForOAuth}
            />
          )}

          {step === 'connect-jira' && (
            <ConnectJiraStep
              onSkip={() => { setIsWaitingForOAuth(false); setStep('success') }}
              connect={connect}
              connectingType={connectingType}
              connectError={connectError}
              isWaitingForOAuth={isWaitingForOAuth}
            />
          )}

          {step === 'success' && (
            <SuccessStep
              unreadCount={gmailConnector?.unreadCount ?? null}
              onFinish={handleFinish}
            />
          )}
        </div>

        {/* Step label */}
        <p className="mt-4 text-center text-xs text-gray-600">
          Krok {stepIndex + 1} z {STEPS.length}
        </p>
      </div>
    </div>
  )
}
