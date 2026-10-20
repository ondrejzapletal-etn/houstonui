import { useId, useState, type ReactNode } from 'react'

interface InfoTooltipProps {
  label: string
  children: ReactNode
}

export default function InfoTooltip({ label, children }: InfoTooltipProps) {
  const tooltipId = useId()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={`Informace o sekci ${label}`}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tooltipId : undefined}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-blue-700 text-[10px] font-bold text-blue-400 hover:border-blue-400 hover:text-blue-200 focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors"
      >
        i
      </button>
      {isOpen && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-blue-800/40 bg-blue-900 px-4 py-3 shadow-lg"
        >
          <p className="text-xs leading-relaxed text-blue-100">{children}</p>
        </div>
      )}
    </div>
  )
}