import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ScanEvent,
  ScanProposalData,
  ScanSummary,
  AutoReadSuggestionItem,
  ScanStatusSnapshot,
} from '@houston/shared-types'

export type { AutoReadSuggestionItem }
import { API_BASE_URL } from '../config/api'
import { useAuthStore } from '../store/authStore'

export type ScanState = 'idle' | 'running' | 'completed' | 'error'

/** Rocket stage – maps to progress-bar-{1,2,3}.webp */
export type ScanPhase = 'idle' | 'fetch' | 'classify' | 'save' | 'done' | 'error'

export interface ScanStreamState {
  state: ScanState
  phase: ScanPhase
  message: string | null
  logs: string[]
  proposals: ScanProposalData[]
  autoReadSuggestions: AutoReadSuggestionItem[]
  summary: ScanSummary | null
  errorMessage: string | null
}

// ─── Last scan persistence ────────────────────────────────────────────────────

const LAST_SCAN_KEY = 'houston_last_scan'
const SCAN_STATUS_POLL_INTERVAL_MS = 2000

export interface LastScanResult {
  proposals: ScanProposalData[]
  autoReadSuggestions: AutoReadSuggestionItem[]
  summary: ScanSummary
  completedAt: string // ISO timestamp
}

export function loadLastScan(): LastScanResult | null {
  try {
    const raw = localStorage.getItem(LAST_SCAN_KEY)
    if (!raw) return null
    return JSON.parse(raw) as LastScanResult
  } catch {
    return null
  }
}

function saveLastScan(result: LastScanResult): void {
  try {
    localStorage.setItem(LAST_SCAN_KEY, JSON.stringify(result))
  } catch {
    // storage full or unavailable – silently ignore
  }
}

export function useScanStream() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const [scanState, setScanState] = useState<ScanStreamState>({
    state: 'idle',
    phase: 'idle',
    message: null,
    logs: [],
    proposals: [],
    autoReadSuggestions: [],
    summary: null,
    errorMessage: null,
  })
  const [isRestoring, setIsRestoring] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!accessToken) {
      setIsRestoring(false)
      return
    }

    let isMounted = true
    let pollTimer: number | undefined

    async function restoreScanStatus(): Promise<void> {
      try {
        const scan = await fetchScanStatus(accessToken)
        if (!isMounted) return

        if (!scan) {
          setIsRestoring(false)
          return
        }

        if (scan.status === 'RUNNING') {
          setScanState({
            state: 'running',
            phase: scan.phase,
            message: scan.message,
            logs: scan.message ? [`⏳ ${scan.message}`] : [],
            proposals: scan.proposals,
            autoReadSuggestions: scan.autoReadSuggestions,
            summary: null,
            errorMessage: null,
          })
          setIsRestoring(false)
          pollTimer = window.setTimeout(() => void restoreScanStatus(), SCAN_STATUS_POLL_INTERVAL_MS)
          return
        }

        if (scan.status === 'COMPLETED') {
          if (scan.summary) {
            saveLastScan({
              proposals: scan.proposals,
              autoReadSuggestions: scan.autoReadSuggestions,
              summary: scan.summary,
              completedAt: scan.completedAt ?? new Date().toISOString(),
            })
          }
          setScanState({
            state: 'completed',
            phase: 'done',
            message: scan.message ?? 'Scan completed.',
            logs: [],
            proposals: scan.proposals,
            autoReadSuggestions: scan.autoReadSuggestions,
            summary: scan.summary,
            errorMessage: null,
          })
        } else {
          setScanState({
            state: 'error',
            phase: 'error',
            message: scan.message ?? 'Scan failed.',
            logs: [],
            proposals: scan.proposals,
            autoReadSuggestions: scan.autoReadSuggestions,
            summary: null,
            errorMessage: scan.message ?? 'Scan failed.',
          })
        }
        setIsRestoring(false)
      } catch {
        if (isMounted) setIsRestoring(false)
      }
    }

    void restoreScanStatus()
    return () => {
      isMounted = false
      if (pollTimer !== undefined) window.clearTimeout(pollTimer)
    }
  }, [accessToken])

  const start = useCallback(async (language?: string) => {
    // Abort any previous scan
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Accumulate proposals and auto-read suggestions so we can persist them on completion
    const proposalsAccumulator: ScanProposalData[] = []
    let autoReadSuggestionsAccumulator: AutoReadSuggestionItem[] = []

    setScanState({
      state: 'running',
      phase: 'fetch',
      message: 'Fetching data from all connected sources…',
      logs: ['🚀 Houston, we have a launch'],
      proposals: [],
      autoReadSuggestions: [],
      summary: null,
      errorMessage: null,
    })

    // Čteme token přímo ze store, protože closure v useCallback může být stará
    const token = useAuthStore.getState().accessToken
    try {
      const url = new URL(`${API_BASE_URL}/scan/stream`)
      if (language) url.searchParams.set('language', language)
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        setScanState((s) => ({ ...s, state: 'error', errorMessage: `HTTP ${res.status}` }))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim()
          if (!json) continue

          let event: ScanEvent
          try {
            event = JSON.parse(json) as ScanEvent
          } catch {
            continue
          }

          handleEvent(event)
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const message = err instanceof Error ? err.message : 'Unknown error'
      setScanState((s) => ({ ...s, state: 'error', errorMessage: message }))
    }

    function handleEvent(event: ScanEvent) {
      switch (event.type) {
        case 'progress':
          setScanState((s) => ({
            ...s,
            phase: event.phase,
            message: event.message,
            logs: [...s.logs, `⏳ ${event.message}`],
          }))
          break
        case 'log': {
          const lines = [`📋 ${event.message}`]
          if (event.detail) lines.push(...event.detail.map((d) => `   ${d}`))
          setScanState((s) => ({ ...s, logs: [...s.logs, ...lines] }))
          break
        }
        case 'proposal':
          proposalsAccumulator.push(event.proposal)
          setScanState((s) => ({ ...s, proposals: [...s.proposals, event.proposal] }))
          break
        case 'auto_read_suggestions':
          autoReadSuggestionsAccumulator = event.items
          setScanState((s) => ({ ...s, autoReadSuggestions: event.items }))
          break
        case 'completed':
          saveLastScan({
            proposals: proposalsAccumulator,
            autoReadSuggestions: autoReadSuggestionsAccumulator,
            summary: event.summary,
            completedAt: new Date().toISOString(),
          })
          setScanState((s) => ({
            ...s,
            state: 'completed',
            phase: 'done',
            message: 'Scan completed.',
            summary: event.summary,
          }))
          break
        case 'error':
          setScanState((s) => ({
            ...s,
            state: 'error',
            phase: 'error',
            message: event.message,
            errorMessage: event.message,
          }))
          break
      }
    }
  }, [accessToken])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setScanState((s) => ({ ...s, state: 'idle', phase: 'idle', message: null }))
  }, [])

  const clearAutoReadSuggestions = useCallback((messageIds?: string[]) => {
    const removedIds = messageIds ? new Set(messageIds) : null
    setScanState((s) => ({
      ...s,
      autoReadSuggestions: removedIds
        ? s.autoReadSuggestions.filter((suggestion) => !removedIds.has(suggestion.messageId))
        : [],
    }))
  }, [])

  return { scanState, start, stop, clearAutoReadSuggestions, isRestoring }
}

async function fetchScanStatus(accessToken: string): Promise<ScanStatusSnapshot | null> {
  const response = await fetch(`${API_BASE_URL}/scan/status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return parseScanStatusResponse(await response.json())
}

function parseScanStatusResponse(value: unknown): ScanStatusSnapshot | null {
  if (!isRecord(value) || !('scan' in value)) throw new Error('Invalid scan status response')
  if (value.scan === null) return null
  if (!isRecord(value.scan)) throw new Error('Invalid scan snapshot')

  const scan = value.scan
  if (
    typeof scan.scanRunId !== 'string' ||
    !isScanStatus(scan.status) ||
    !isScanPhase(scan.phase) ||
    !isNullableString(scan.message) ||
    typeof scan.startedAt !== 'string' ||
    !isNullableString(scan.completedAt) ||
    !Array.isArray(scan.proposals) ||
    !Array.isArray(scan.autoReadSuggestions)
  ) {
    throw new Error('Invalid scan snapshot')
  }

  const summary = parseSummary(scan.summary)
  if (scan.summary !== null && !summary) throw new Error('Invalid scan summary')

  return {
    scanRunId: scan.scanRunId,
    status: scan.status,
    phase: scan.phase,
    message: scan.message,
    startedAt: scan.startedAt,
    completedAt: scan.completedAt,
    summary,
    proposals: scan.proposals.filter(isScanProposalData),
    autoReadSuggestions: scan.autoReadSuggestions.filter(isAutoReadSuggestionItem),
  }
}

function parseSummary(value: unknown): ScanSummary | null {
  if (value === null) return null
  if (!isRecord(value) || !isNumberRecord(value.tierCounts) || !isNumberRecord(value.sources)) return null
  if (typeof value.totalItems !== 'number' || typeof value.proposalCount !== 'number') return null
  return { tierCounts: value.tierCounts, totalItems: value.totalItems, proposalCount: value.proposalCount, sources: value.sources }
}

function isScanProposalData(value: unknown): value is ScanProposalData {
  return isRecord(value) && typeof value.id === 'string' && typeof value.system === 'string' &&
    typeof value.tier === 'number' && typeof value.summary === 'string'
}

function isAutoReadSuggestionItem(value: unknown): value is AutoReadSuggestionItem {
  return isRecord(value) &&
    typeof value.messageId === 'string' &&
    typeof value.subject === 'string' &&
    typeof value.from === 'string' &&
    typeof value.receivedAt === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'number')
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isScanStatus(value: unknown): value is ScanStatusSnapshot['status'] {
  return value === 'RUNNING' || value === 'COMPLETED' || value === 'FAILED'
}

function isScanPhase(value: unknown): value is Exclude<ScanPhase, 'idle'> {
  return value === 'fetch' || value === 'classify' || value === 'save' || value === 'done' || value === 'error'
}

/** Derive the current rocket stage from a backend progress message. */
function derivePhase(message: string): ScanPhase {
  const m = message.toLowerCase()
  if (m.includes('classif')) return 'classify'
  if (m.includes('saving') || m.includes('proposals')) return 'save'
  return 'fetch'
}
