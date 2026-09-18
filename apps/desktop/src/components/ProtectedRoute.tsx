import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

interface ProtectedRouteProps {
  children: React.ReactNode
  /**
   * False while the session-restore call from App is still in flight. Without
   * this the component would redirect a returning user to /login on every
   * reload, before the httpOnly cookie has had a chance to be exchanged.
   */
  sessionChecked?: boolean
}

export default function ProtectedRoute({ children, sessionChecked = true }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuth()

  if (!sessionChecked) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <p className="text-white">Přihlašování…</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
