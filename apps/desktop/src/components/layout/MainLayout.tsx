import type { ReactNode } from 'react'
import Header from './Header'
import Footer from './Footer'
import DbEnrichmentToast from '../DbEnrichmentToast'

interface MainLayoutProps {
  children: ReactNode
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <Header />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <Footer />
      <DbEnrichmentToast />
    </div>
  )
}
