import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { UserStats } from '@houston/shared-types'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import { API_BASE_URL } from '../../config/api'
import { fetchJiraWorklogStats } from '../../services/connectorsClient'
import { useTimeSaved } from '../../hooks/useTimeSaved'
import { TIME_SAVED_KINDS } from '@houston/shared-types'
import type { TimeSavedBucket, TimeSavedKind } from '@houston/shared-types'

function StatItem({ label, value, dim }: { label: string; value: React.ReactNode; dim?: boolean }) {
  return (
    <div className={`flex gap-2 mb-1 ${dim ? 'text-gray-300' : ''}`}>
      <span className="text-gray-500">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>
}

function formatDay(period: string): string {
  return new Date(`${period}T00:00:00Z`).toLocaleDateString('cs-CZ', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
}

function formatMinutesShort(seconds: number): string {
  if (seconds <= 0) return '0 min'
  const minutes = Math.round(seconds / 60)
  return minutes < 1 ? '<1 min' : `${minutes} min`
}

function timeSavedBucketSeconds(
  bucket: TimeSavedBucket,
  secondsPerKind: Record<TimeSavedKind, number>,
): number {
  return TIME_SAVED_KINDS.reduce((sum, kind) => sum + bucket.counts[kind] * secondsPerKind[kind], 0)
}

function TimeSavedChart({
  buckets,
  secondsPerKind,
}: {
  buckets: TimeSavedBucket[]
  secondsPerKind: Record<TimeSavedKind, number>
}) {
  const seconds = buckets.map((bucket) => timeSavedBucketSeconds(bucket, secondsPerKind))
  const maximumSeconds = Math.max(...seconds, 0)

  return (
    <div className="mt-5" aria-label="Úspora času za posledních 7 dní v minutách">
      <div className="flex h-28 items-end gap-3 border-b border-l border-gray-700 px-3 pt-2">
        {buckets.map((bucket, i) => {
          const bucketSeconds = seconds[i]
          const height = maximumSeconds === 0 ? 0 : Math.max((bucketSeconds / maximumSeconds) * 100, 4)
          return (
            <div key={bucket.period} className="h-full min-w-0 flex-1">
              <div className="relative h-[calc(100%-1.25rem)]">
                <span
                  className="absolute inset-x-0 text-center text-xs text-gray-400"
                  style={{ bottom: `calc(${height}% + 0.25rem)` }}
                >
                  {formatMinutesShort(bucketSeconds)}
                </span>
                <div
                  className="absolute bottom-0 left-1/2 w-full max-w-10 -translate-x-1/2 bg-teal-500"
                  style={{ height: `${height}%` }}
                  title={`${formatDay(bucket.period)}: ${formatSeconds(bucketSeconds)}`}
                />
              </div>
              <span className="block h-5 text-center text-xs text-gray-500">{formatDay(bucket.period)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

async function fetchUserStats(token?: string | null): Promise<UserStats> {
  const res = await fetch(`${API_BASE_URL}/users/me/stats`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'Failed to fetch user stats')
    throw new Error(text)
  }
  return (await res.json()) as UserStats
}

// Formats seconds to "Xh Ym" or "Ys" for sub-minute values. Returns "0s" for zero/negative.
function formatSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s'
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const parts: string[] = []
  if (hrs) parts.push(`${hrs}h`)
  if (mins) parts.push(`${mins}m`)
  if (secs && hrs === 0) parts.push(`${secs}s`)
  return parts.join(' ')
}

export default function StatsSection() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const {
    timeSavingsSecondsPerScan,
    timeSavingsSecondsPerMessage,
    timeSavingsSecondsPerAutoRead,
    timeSavingsSecondsPerMarkRead,
    timeSavingsSecondsPerWorklog,
  } = useSettingsStore()

  const { data, isLoading, isError } = useQuery<UserStats, Error>({
    queryKey: ['user-stats', accessToken ?? null],
    queryFn: () => fetchUserStats(accessToken),
    refetchOnWindowFocus: false,
  })
  const { data: jiraWorklogStats } = useQuery({
    queryKey: ['jira-worklog-stats', accessToken ?? null],
    queryFn: () => fetchJiraWorklogStats(accessToken ?? ''),
    enabled: Boolean(accessToken),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const timeSaved = useTimeSaved()
  const scansCount = data?.scansCount ?? 0
  const proposalsCount = data?.proposalsCount ?? 0
  const processedMessagesCount = data?.processedMessagesCount ?? 0
  const autoReadCount = data?.autoReadCount ?? 0
  const markReadCount = data?.markReadCount ?? 0
  const worklogsCount = jiraWorklogStats?.count
  const worklogsSeconds = jiraWorklogStats?.seconds

  const totalSavingsSeconds = useMemo(
    () =>
      processedMessagesCount * timeSavingsSecondsPerMessage +
      autoReadCount * timeSavingsSecondsPerAutoRead +
      markReadCount * timeSavingsSecondsPerMarkRead +
      scansCount * timeSavingsSecondsPerScan,
    [
      processedMessagesCount,
      autoReadCount,
      markReadCount,
      scansCount,
      timeSavingsSecondsPerMessage,
      timeSavingsSecondsPerAutoRead,
      timeSavingsSecondsPerMarkRead,
      timeSavingsSecondsPerScan,
    ],
  )

  const worklogsEstimateSeconds = worklogsCount === undefined ? undefined : worklogsCount * timeSavingsSecondsPerWorklog
  const secondsPerKind: Record<TimeSavedKind, number> = {
    scan: timeSavingsSecondsPerScan,
    processed_message: timeSavingsSecondsPerMessage,
    auto_read: timeSavingsSecondsPerAutoRead,
    mark_read: timeSavingsSecondsPerMarkRead,
    worklog: timeSavingsSecondsPerWorklog,
  }
  const dailyTimeSaved = timeSaved.data?.daily ?? []
  const lastSevenDaysTimeSaved = dailyTimeSaved.slice(-7)
  const lastSevenDaysSeconds = lastSevenDaysTimeSaved.reduce(
    (total, bucket) => total + timeSavedBucketSeconds(bucket, secondsPerKind),
    0,
  )

  const val = (n: React.ReactNode) => (isLoading ? '...' : n)

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4 uppercase">Statistiky</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
        <Card>
          <StatItem label="Počet scanů" value={val(scansCount)} />
          <StatItem label="Vygenerované návrhy" value={val(proposalsCount)} />
          <StatItem label="Odeslané zprávy" value={val(processedMessagesCount)} />
          <StatItem label="Automaticky označené přečtené" value={val(autoReadCount)} dim />
          <StatItem label="Označené jako přečtené" value={val(markReadCount)} />
          <StatItem label="Počet výkazů práce" value={worklogsCount} />
        </Card>

        <Card>
          {worklogsCount === undefined || worklogsSeconds === undefined ? (
            <div className="text-gray-500">Načítají se reálná data z Jira...</div>
          ) : (
            <>
              <StatItem label="Odhadovaná úspora za výkazy" value={formatSeconds(worklogsEstimateSeconds ?? 0)} />
              <StatItem
                label="Odhadovaná úspora za komunikaci"
                value={val(formatSeconds(totalSavingsSeconds))}
              />
              <a href="/settings#time-savings" className="text-blue-400 hover:text-blue-300 hover:underline">
                Nastavení parametrů úspory času
              </a>
            </>
          )}
        </Card>

        <Card className="">
          {timeSaved.isLoading ? (
            <div className="text-gray-500">Načítá se úspora času...</div>
          ) : lastSevenDaysTimeSaved.length > 0 ? (
            <>
              <StatItem
                label="Úspora času za posledních 7 dní"
                value={formatSeconds(lastSevenDaysSeconds)}
              />
              <TimeSavedChart buckets={lastSevenDaysTimeSaved} secondsPerKind={secondsPerKind} />
              <Link
                to="/reports"
                className="mt-4 inline-block text-sm font-medium text-blue-400 hover:text-blue-300 hover:underline"
              >
                Reporty
              </Link>
            </>
          ) : (
            <div className="text-gray-500">Data o úspoře času nejsou k dispozici.</div>
          )}
          {timeSaved.isError && <div className="mt-2 text-red-500">Nepodařilo se načíst úsporu času</div>}
        </Card>
      </div>
      {isError && <div className="text-red-500 mt-2">Nepodařilo se načíst statistiky</div>}
    </section>
  )
}
