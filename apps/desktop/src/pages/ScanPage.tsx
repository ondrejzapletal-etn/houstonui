import { useCallback } from 'react'
import type { ScanProposalData } from '@houston/shared-types'
import { useScanStream } from '../services/scanService'
import { API_BASE_URL } from '../config/api'

export default function ScanPage() {
  const { scanState, start, stop } = useScanStream()
  const { state, logs, proposals, summary, errorMessage } = scanState

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Houston Scan</h1>
          <div className="flex gap-2">
            {state !== 'running' ? (
              <button
                onClick={() => void start()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors"
              >
                Start scan
              </button>
            ) : (
              <button
                onClick={stop}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {/* Status */}
        {state === 'running' && (
          <div className="flex items-center gap-2 text-indigo-400">
            <span className="animate-pulse">●</span>
            <span className="text-sm">Scanning…</span>
          </div>
        )}
        {state === 'error' && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
            {errorMessage}
          </div>
        )}
        {state === 'completed' && summary && (
          <div className="bg-green-950 border border-green-800 rounded-lg p-4 text-green-300 text-sm">
            Scan complete — {summary.totalItems} items classified,{' '}
            {summary.proposalCount} proposals generated.
          </div>
        )}

        {/* Log stream */}
        {logs.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-4 font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
            {logs.map((line, i) => (
              <div key={i} className="text-gray-400">
                {line}
              </div>
            ))}
          </div>
        )}

        {/* Proposals */}
        {proposals.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Proposals</h2>
            {proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {state === 'idle' && proposals.length === 0 && (
          <div className="text-center text-gray-500 py-20">
            <p className="text-lg">No scan running.</p>
            <p className="text-sm mt-1">Press "Start scan" to scan all connected sources.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ProposalCard({ proposal }: { proposal: ScanProposalData }) {
  const approve = useProposalAction(proposal.id, 'approve')
  const reject = useProposalAction(proposal.id, 'reject')

  const tierColor: Record<number, string> = {
    1: 'border-red-700 bg-red-950',
    2: 'border-orange-700 bg-orange-950',
  }
  const tierLabel: Record<number, string> = {
    1: 'Action Required',
    2: 'Important Update',
  }

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${tierColor[proposal.tier] ?? 'border-gray-700 bg-gray-900'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Tier {proposal.tier} · {tierLabel[proposal.tier] ?? 'FYI'} · {proposal.system}
          </span>
          <p className="font-medium mt-0.5">{proposal.summary}</p>
        </div>
        {proposal.confidence !== undefined && (
          <span className="text-xs text-gray-500 shrink-0">
            {Math.round(proposal.confidence * 100)}% confidence
          </span>
        )}
      </div>

      {proposal.detail && (
        <p className="text-sm text-gray-300">{proposal.detail}</p>
      )}

      {proposal.draft && (
        <div className="bg-gray-800 rounded p-3 text-sm text-gray-200 whitespace-pre-wrap">
          {proposal.draft}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => approve()}
          className="px-3 py-1 text-sm bg-green-700 hover:bg-green-600 rounded transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => reject()}
          className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          Dismiss
        </button>
        {proposal.url && (
          <a
            href={proposal.url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Open ↗
          </a>
        )}
      </div>
    </div>
  )
}

function useProposalAction(proposalId: string, action: 'approve' | 'reject') {
  return useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/proposals/${proposalId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      // best-effort; in production this would show a toast notification
    }
  }, [proposalId, action])
}
