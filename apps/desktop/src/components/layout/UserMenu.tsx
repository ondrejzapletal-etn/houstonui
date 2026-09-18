import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

export default function UserMenu({ email }: { email: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { logout } = useAuth()

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const handleLogout = async () => {
    setIsOpen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div ref={menuRef} className="relative min-w-0">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={email}
        onClick={() => setIsOpen((open) => !open)}
        className="max-w-40 truncate rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-1 focus:ring-yellow-400 sm:max-w-60"
      >
        {email}
      </button>
      {isOpen && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-40 rounded-md border border-gray-700 bg-gray-900 py-1 shadow-lg">
          <Link role="menuitem" to="/settings" onClick={() => setIsOpen(false)} className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white">
            Nastavení
          </Link>
          <Link role="menuitem" to="/reports" onClick={() => setIsOpen(false)} className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white">
            Reporty
          </Link>
          <div className="my-1 border-t border-gray-800" />
          <button type="button" role="menuitem" onClick={handleLogout} className="block w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-800 hover:text-red-300">
            Odhlásit se
          </button>
        </div>
      )}
    </div>
  )
}