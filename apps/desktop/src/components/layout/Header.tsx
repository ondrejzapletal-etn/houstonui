import { NavLink, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { UserStats } from '@houston/shared-types'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import { API_BASE_URL } from '../../config/api'
import { fetchJiraWorklogStats } from '../../services/connectorsClient'
import UserMenu from './UserMenu'

function formatTotalSavings(seconds: number): string {
  if (seconds <= 0) return '0s'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainingSeconds = seconds % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (remainingSeconds) parts.push(`${remainingSeconds}s`)
  return parts.join(' ')
}

async function fetchUserStats(token: string | null): Promise<UserStats> {
  const response = await fetch(`${API_BASE_URL}/users/me/stats`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new Error('Failed to fetch user stats')
  return (await response.json()) as UserStats
}

function TotalSavings() {
  const accessToken = useAuthStore((state) => state.accessToken)
  const {
    timeSavingsSecondsPerScan,
    timeSavingsSecondsPerMessage,
    timeSavingsSecondsPerAutoRead,
    timeSavingsSecondsPerMarkRead,
    timeSavingsSecondsPerWorklog,
  } = useSettingsStore()
  const { data: userStats } = useQuery<UserStats, Error>({
    queryKey: ['user-stats', accessToken],
    queryFn: () => fetchUserStats(accessToken),
    enabled: Boolean(accessToken),
    refetchOnWindowFocus: false,
  })
  const { data: jiraWorklogStats } = useQuery({
    queryKey: ['jira-worklog-stats', accessToken],
    queryFn: () => fetchJiraWorklogStats(accessToken ?? ''),
    enabled: Boolean(accessToken),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const worklogsCount = jiraWorklogStats?.count ?? userStats?.worklogsCount ?? 0
  const totalSeconds =
    (userStats?.scansCount ?? 0) * timeSavingsSecondsPerScan +
    (userStats?.processedMessagesCount ?? 0) * timeSavingsSecondsPerMessage +
    (userStats?.autoReadCount ?? 0) * timeSavingsSecondsPerAutoRead +
    (userStats?.markReadCount ?? 0) * timeSavingsSecondsPerMarkRead +
    worklogsCount * timeSavingsSecondsPerWorklog

  return (
    <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-300" title="Celková úspora času">
      <img src="/img/ico-savings.webp" alt="" className="h-5 w-5" />
      {formatTotalSavings(totalSeconds)}
    </span>
  )
}

export default function Header() {
  const { isAuthenticated, user } = useAuthStore()
  return (
    <header className="shrink-0 border-b border-gray-800 bg-gray-950 px-6 py-3 flex items-center justify-between">
      {/* Logo + title */}
      <Link
        to="/"
        aria-label="Houston - Dashboard"
        className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-all duration-200 hover:scale-[1.03] hover:bg-gray-800 hover:shadow-lg hover:shadow-cyan-500/10"
      >
        <img
          src="/logo.webp"
          alt="Houston raketa"
          className="inline-block h-7 w-7 align-middle transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:rotate-3"
          aria-hidden="true"
        />
        <span className="text-lg font-bold tracking-tight text-white transition-colors duration-200 group-hover:text-cyan-100">
          Houston
        </span>
      </Link>

      {/* Navigation */}
      <nav aria-label="Main navigation" className="hidden sm:flex items-center gap-1">
        <NavLink
          to="/"
          className={({ isActive }) =>
            [
              'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50',
            ].join(' ')
          }
        >
          Dashboard
        </NavLink>

        <NavLink
          to="/context"
          className={({ isActive }) =>
            [
              'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50',
            ].join(' ')
          }
        >
          Context
        </NavLink>

        <NavLink
          to="/knowledge"
          className={({ isActive }) =>
            [
              'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50',
            ].join(' ')
          }
        >
          Knowledge
        </NavLink>

      </nav>

      {/* Auth area */}
      <div className="flex items-center gap-2">
        {isAuthenticated && <TotalSavings />}
        {isAuthenticated && user ? (
          <UserMenu email={user.email} />
        ) : (
          <Link
            to="/login"
            className="text-sm font-medium px-4 py-1.5 rounded-lg bg-gray-800 text-gray-200 hover:bg-gray-700 hover:text-white transition-colors"
          >
            Login
          </Link>
        )}
      </div>
    </header>
  )
}
