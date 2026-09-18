import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import {
  fetchConnectors,
  refreshConnectorUnread,
  initiateConnectorConnect,
  disconnectConnector,
} from '../services/connectorsClient'
import type { ConnectorInfo, ConnectorType } from '@houston/shared-types'

export const CONNECTORS_QUERY_KEY = ['connectors'] as const

export interface UseConnectorsResult {
  connectors: ConnectorInfo[]
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  refetch: () => void
  refreshOne: (type: ConnectorType) => Promise<void>
  isRefreshing: boolean
  connect: (type: ConnectorType) => void
  disconnect: (type: ConnectorType) => void
  connectingType: ConnectorType | null
  disconnectingType: ConnectorType | null
  connectError: string | null
  disconnectError: string | null
}

export function useConnectors(): UseConnectorsResult {
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: CONNECTORS_QUERY_KEY,
    queryFn: () => fetchConnectors(accessToken ?? ''),
    enabled: true, // DEV: backend accepts unauthenticated requests in development mode
    staleTime: 60_000, // 1 minute – backend refreshes every 5 min in background
  })

  /**
   * Triggers a live unread refresh for a single connector and updates the
   * query cache in-place so the UI responds immediately.
   */
  async function refreshOne(type: ConnectorType): Promise<void> {
    const updated = await refreshConnectorUnread(accessToken ?? '', type)
    queryClient.setQueryData(
      CONNECTORS_QUERY_KEY,
      (prev: { connectors: ConnectorInfo[] } | undefined) => {
        if (!prev) return prev
        return {
          connectors: prev.connectors.map((c) => (c.id === type ? updated : c)),
        }
      },
    )
  }

  const OAUTH_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
  const [oauthPendingUntil, setOauthPendingUntil] = useState<number | null>(null)

  useEffect(() => {
    if (oauthPendingUntil === null) return

    function handleReturn() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() > oauthPendingUntil!) return
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
      setOauthPendingUntil(null)
    }

    document.addEventListener('visibilitychange', handleReturn)
    window.addEventListener('focus', handleReturn)
    return () => {
      document.removeEventListener('visibilitychange', handleReturn)
      window.removeEventListener('focus', handleReturn)
    }
  }, [oauthPendingUntil, queryClient])

  const connectMutation = useMutation<void, Error, ConnectorType>({
    mutationFn: async (type) => {
      // In dev mode the backend accepts unauthenticated requests; pass empty string
      // so the header is omitted (see initiateConnectorConnect).
      const authUrl = await initiateConnectorConnect(accessToken ?? '', type)
      // Open validated OAuth URL in the system browser.
      window.open(authUrl, '_blank', 'noopener,noreferrer')
    },
    onSuccess: () => {
      // Refresh immediately in case OAuth completes quickly (e.g. already logged in),
      // and also arm the visibilitychange listener for slower flows.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
      }, 3000)
      setOauthPendingUntil(Date.now() + OAUTH_WINDOW_MS)
    },
  })

  const disconnectMutation = useMutation<void, Error, ConnectorType>({
    mutationFn: async (type) => {
      // In dev mode the backend accepts unauthenticated requests; pass empty string
      // so the header is omitted (see disconnectConnector).
      await disconnectConnector(accessToken ?? '', type)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
    },
  })

  return {
    connectors: data?.connectors ?? [],
    isLoading,
    isError,
    errorMessage: isError && error instanceof Error ? error.message : null,
    refetch: () => void refetch(),
    refreshOne,
    isRefreshing: isFetching && !isLoading,
    connect: (type) => connectMutation.mutate(type),
    disconnect: (type) => disconnectMutation.mutate(type),
    connectingType: connectMutation.isPending ? (connectMutation.variables ?? null) : null,
    disconnectingType: disconnectMutation.isPending ? (disconnectMutation.variables ?? null) : null,
    connectError: connectMutation.error?.message ?? null,
    disconnectError: disconnectMutation.error?.message ?? null,
  }
}
