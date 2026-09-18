import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import OnboardingPage from './pages/OnboardingPage'
import SettingsPage from './pages/SettingsPage'
import ReportsPage from './pages/ReportsPage'
import ContextPage from './pages/ContextPage'
import KnowledgePage from './pages/KnowledgePage'
import GoogleCallbackPage from './pages/GoogleCallbackPage'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuthStore } from './store/authStore'
import { useTokenRefresh } from './hooks/useTokenRefresh'
import { restoreSession } from './services/authClient'
import type { UserProfile } from '@houston/shared-types'
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
})

export default function App() {
  const { isAuthenticated, setAuth } = useAuthStore()
  // Until the cookie exchange has been attempted we cannot tell "logged out"
  // from "not restored yet" – redirecting during that window would bounce a
  // returning user to /login on every reload.
  const [sessionChecked, setSessionChecked] = useState(false)

  useTokenRefresh()

  useEffect(() => {
    if (isAuthenticated) {
      setSessionChecked(true)
      return
    }
    restoreSession()
      .then((result) => {
        if (!result) return
        const user: UserProfile = {
          id: result.user.id,
          email: result.user.email,
          displayName: result.user.displayName,
        }
        setAuth(result.accessToken, user, result.expiresIn)
      })
      .catch(() => {})
      .finally(() => setSessionChecked(true))
  }, [isAuthenticated, setAuth])

  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute sessionChecked={sessionChecked}>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute sessionChecked={sessionChecked}>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute sessionChecked={sessionChecked}>
              <ReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/context"
          element={
            <ProtectedRoute sessionChecked={sessionChecked}>
              <ContextPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/knowledge"
          element={
            <ProtectedRoute sessionChecked={sessionChecked}>
              <KnowledgePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute sessionChecked={sessionChecked}>
              <OnboardingPage />
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </QueryClientProvider>
  )
}
