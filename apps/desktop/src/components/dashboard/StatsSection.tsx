import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../store/authStore'
import { API_BASE_URL } from '../../config/api'

type UserStats = {
  processedMessagesCount: number
  proposalsCount: number
}

export default function StatsSection() {
  const accessToken = useAuthStore((s) => s.accessToken)

  const { data, isLoading, isError, refetch } = useQuery<UserStats, Error>({
    queryKey: ['user-stats', accessToken ?? null],
    queryFn: async ({ queryKey }) => {
      const [_key, token] = queryKey as [string, string | null]
      const res = await fetch(`${API_BASE_URL}/users/me/stats`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const text = await res.text().catch(() => 'Failed to fetch user stats')
        throw new Error(text)
      }
      return (await res.json()) as UserStats
    },
    refetchOnWindowFocus: false,
  })

  function StatCard({ label, children, dim }: { label: string; children: React.ReactNode; dim?: boolean }) {
    return (
      <div className={`card ${dim ? 'text-gray-300' : ''}`}>
        <div className="text-xs text-gray-500 mb-1">{label}</div>
        <div className="font-bold">{children}</div>
      </div>
    )
  }

  function RefreshableProcessedMessages() {
    return (
      <StatCard label="Počet zpráv odbavených přes Houston" dim>
        <div className="flex items-center gap-2">
          <span>{isLoading ? '...' : data?.processedMessagesCount ?? 0}</span>
          <button
            onClick={() => void refetch()}
            title="Obnovit"
            className="text-xs px-2 py-1 bg-gray-800 rounded hover:bg-gray-700"
            disabled={isLoading}
          >
            {isLoading ? '...' : 'Obnovit'}
          </button>
        </div>
      </StatCard>
    )
  }

  function ProposalsCard() {
    return (
      <StatCard label="Vygenerovaných proposals" dim>
        <span>{isLoading ? '...' : data?.proposalsCount ?? 0}</span>
      </StatCard>
    )
  }

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4 uppercase">Statistiky</h2>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <RefreshableProcessedMessages />
        <ProposalsCard />
        <StatCard label="Počet zpráv označených automaticky jako přečtené">250</StatCard>
        <StatCard label="Odhad ušetřené doby">4h 25m</StatCard>
        <StatCard label="Spotřeba tokenů">545</StatCard>
        <StatCard label="Počet výkazů zadaných přes Houston">24</StatCard>
      </div>
      {isError && <div className="text-red-500 mt-2">Nepodařilo se načíst statistiky</div>}
    </section>
  )
}
