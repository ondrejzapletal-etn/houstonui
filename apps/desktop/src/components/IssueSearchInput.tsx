import { useId, useRef, useState } from 'react'
import { useIssueSearch } from '../hooks/useIssueSearch'

interface Props {
  value: string
  onChange: (issueKey: string, summary?: string) => void
  placeholder?: string
  required?: boolean
  inputRef?: React.RefObject<HTMLInputElement>
}

/**
 * Autocomplete input for Jira issue keys.
 *
 * Searches the local issue cache as the user types and offers matching issues
 * as a dropdown. The user can still type any issue key manually.
 */
export default function IssueSearchInput({ value, onChange, placeholder = 'PROJ-123', required, inputRef }: Props) {
  const listId = useId()
  const internalRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? internalRef

  const [open, setOpen] = useState(false)
  const { data: suggestions = [] } = useIssueSearch(value)

  // Close dropdown when focus leaves the container
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setOpen(false)
    }
  }

  return (
    <div className="relative" onBlur={handleBlur}>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
        aria-autocomplete="list"
        aria-controls={open && suggestions.length > 0 ? listId : undefined}
        aria-expanded={open && suggestions.length > 0}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-md border border-gray-700 bg-gray-900 shadow-lg max-h-52 overflow-y-auto"
        >
          {suggestions.map((issue: { issueKey: string; summary: string }) => (
            <li
              key={issue.issueKey}
              role="option"
              aria-selected={value === issue.issueKey}
              onMouseDown={(e) => {
                // Prevent blur before click
                e.preventDefault()
                onChange(issue.issueKey, issue.summary)
                setOpen(false)
              }}
              className="flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm hover:bg-gray-800"
            >
              <span className="shrink-0 font-mono text-yellow-400">{issue.issueKey}</span>
              <span className="truncate text-gray-300">{issue.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
