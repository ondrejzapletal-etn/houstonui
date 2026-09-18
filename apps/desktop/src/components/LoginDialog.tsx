import { useState } from 'react'
import { initiateLogin } from '../services/authClient'

export default function LoginDialog() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { authUrl } = await initiateLogin()
      window.open(authUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Houston</h1>
        <p className="text-gray-400">AI-powered productivity</p>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Sign in</h2>
          <p className="text-sm text-gray-400">Use your Microsoft account to continue</p>
        </div>
        {error && (
          <div
            role="alert"
            className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300"
          >
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={handleLogin}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium px-4 py-3 rounded-lg transition-colors"
        >
          {isLoading ? (
            <>
              <span
                aria-hidden="true"
                className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"
              />
              Redirecting...
            </>
          ) : (
            <>
              <svg className="h-5 w-5" viewBox="0 0 21 21" fill="none" aria-hidden="true">
                <title>Microsoft logo</title>
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </>
          )}
        </button>
      </div>
      <p className="text-center text-xs text-gray-600">Houston NextGen · Secure by design</p>
    </div>
  )
}
