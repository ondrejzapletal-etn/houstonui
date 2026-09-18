
import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import AppLayout from '../components/layout/AppLayout'
import SourcesSection from '../components/dashboard/SourcesSection'
import WorklogsSection from '../components/dashboard/WorklogsSection'
import ActionsSection from '../components/dashboard/ActionsSection'
import CalendarSection from '../components/dashboard/CalendarSection'
import StatsSection from '../components/dashboard/StatsSection'
import { useConnectors, CONNECTORS_QUERY_KEY } from '../hooks/useConnectors'

const ONBOARDING_DONE_KEY = 'houston_onboarding_complete'

export default function DashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { connectors, isLoading } = useConnectors()

  // Handle OAuth callback redirect: ?jira=connected / ?gmail=connected etc.
  // The backend redirects here after a successful OAuth flow. Invalidate the
  // connectors cache so the UI immediately reflects the new connection, then
  // strip the query param from the URL so refreshing doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const hasOAuthCallback = Array.from(params.values()).some((v) => v === 'connected')
    if (!hasOAuthCallback) return

    void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY })
    void navigate('/', { replace: true })
  }, [location.search, queryClient, navigate])

  // Once at least one connector is active, persist the flag so we never
  // redirect back to onboarding (even after a backend restart wipes tokens).
  useEffect(() => {
    if (isLoading) return
    const hasConnected = connectors.some((c) => c.status === 'connected')
    if (hasConnected) {
      localStorage.setItem(ONBOARDING_DONE_KEY, '1')
      return
    }
    if (localStorage.getItem(ONBOARDING_DONE_KEY)) return
    void navigate('/onboarding', { replace: true })
  }, [isLoading, connectors, navigate])

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <SourcesSection />
        <WorklogsSection />
        <ActionsSection />
        <CalendarSection />
        <StatsSection />
      </div>
    </AppLayout>
  )
}
