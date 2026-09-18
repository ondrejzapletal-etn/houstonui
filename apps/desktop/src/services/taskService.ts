import { useCallback, useRef, useState } from 'react'
import type { TaskEvent, ScanProposalData } from '@houston/shared-types'
import { API_BASE_URL } from '../config/api'
import { useAuthStore } from '../store/authStore'

export type TaskState = 'idle' | 'running' | 'completed' | 'error'

export interface TaskStreamState {
  state: TaskState
  phase: string
  logs: string[]
  result: string | null
  proposals: ScanProposalData[]
  errorMessage: string | null
}

const INITIAL_STATE: TaskStreamState = {
  state: 'idle',
  phase: 'idle',
  logs: [],
  result: null,
  proposals: [],
  errorMessage: null,
}

export function useTaskStream() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const [taskState, setTaskState] = useState<TaskStreamState>(INITIAL_STATE)
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(
    async (request: string, language?: string, allowLiveData?: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setTaskState({
        state: 'running',
        phase: 'analyze',
        logs: [],
        result: null,
        proposals: [],
        errorMessage: null,
      })

      const token = useAuthStore.getState().accessToken
      try {
        const url = new URL(`${API_BASE_URL}/task/execute`)
        url.searchParams.set('request', request)
        if (language) url.searchParams.set('language', language)
        if (allowLiveData) url.searchParams.set('allowLiveData', 'true')

        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          setTaskState((s) => ({ ...s, state: 'error', errorMessage: `HTTP ${res.status}` }))
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
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const json = line.slice(6).trim()
            if (!json) continue

            let event: TaskEvent
            try {
              event = JSON.parse(json) as TaskEvent
            } catch {
              continue
            }

            handleEvent(event)
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const message = err instanceof Error ? err.message : 'Unknown error'
        setTaskState((s) => ({ ...s, state: 'error', errorMessage: message }))
      }

      function handleEvent(event: TaskEvent) {
        switch (event.type) {
          case 'progress':
            setTaskState((s) => ({
              ...s,
              phase: event.phase,
              logs: [...s.logs, `⏳ ${event.message}`],
            }))
            break
          case 'log':
            setTaskState((s) => ({ ...s, logs: [...s.logs, `📋 ${event.message}`] }))
            break
          case 'result':
            setTaskState((s) => ({ ...s, result: event.content }))
            break
          case 'proposal':
            setTaskState((s) => ({ ...s, proposals: [...s.proposals, event.proposal] }))
            break
          case 'completed':
            setTaskState((s) => ({ ...s, state: 'completed', phase: 'done' }))
            break
          case 'error':
            setTaskState((s) => ({
              ...s,
              state: 'error',
              phase: 'error',
              errorMessage: event.message,
            }))
            break
        }
      }
    },
    [accessToken],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setTaskState(INITIAL_STATE)
  }, [])

  return { taskState, start, reset }
}
