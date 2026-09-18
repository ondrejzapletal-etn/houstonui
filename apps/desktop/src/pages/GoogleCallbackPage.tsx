import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import type { UserProfile } from '@houston/shared-types'

export default function GoogleCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setAuth = useAuthStore((s) => s.setAuth)
  const processed = useRef(false)

  useEffect(() => {
    if (processed.current) return
    processed.current = true

    const token = searchParams.get('token')
    const expiresIn = Number(searchParams.get('expiresIn') ?? '900')
    const userId = searchParams.get('userId')
    const email = searchParams.get('email')
    const displayName = searchParams.get('displayName')

    if (!token || !userId || !email) {
      navigate('/login', { replace: true })
      return
    }

    const user: UserProfile = { id: userId, email, displayName: displayName ?? '' }
    setAuth(token, user, expiresIn)
    navigate('/', { replace: true })
  }, [navigate, searchParams, setAuth])

  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <p className="text-white">Přihlašování…</p>
    </div>
  )
}
