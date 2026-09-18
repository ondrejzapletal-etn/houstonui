import { useQuery } from '@tanstack/react-query'
import type { HotSpotVacationResponse } from '@houston/shared-types'
import { fetchHotSpotVacation } from '../services/connectorsClient'
import { useAuthStore } from '../store/authStore'
import { useConnectors } from './useConnectors'

export function useHotSpotVacation(year: number, month: number, workingDayHours: number) {
  const accessToken = useAuthStore((state) => state.accessToken)
  const { connectors = [] } = useConnectors()
  const isConnected = connectors.some(
    (connector) => connector.id === 'hotspot' && connector.status === 'connected',
  )
  const query = useQuery<HotSpotVacationResponse>({
    queryKey: ['hotspot-vacation', 'unique-slots-v2', year, month, workingDayHours],
    queryFn: () => fetchHotSpotVacation(accessToken ?? '', year, month, workingDayHours),
    enabled: isConnected,
    staleTime: 5 * 60 * 1000,
  })

  return {
    seconds: query.data?.seconds ?? 0,
    isConnected,
    isLoading: isConnected && query.isLoading,
    isError: query.isError,
  }
}