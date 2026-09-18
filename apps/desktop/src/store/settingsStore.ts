import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Max number of recent Jira issue keys to remember */
const MAX_RECENT_ISSUES = 10

export interface RecentJiraIssue {
  key: string
  summary?: string
}

/** Supported application languages */
export type AppLanguage = 'cs' | 'en'

/** Application theme */
export type AppTheme = 'dark' | 'light'

/**
 * Agent autonomy level as defined in zadani2.md §7.3:
 *   0 – analysis only
 *   1 – action proposals (default for v1)
 *   2 – low-risk automatic actions (opt-in)
 *   3 – sensitive automatic actions (not recommended)
 */
export type AgentAutonomyLevel = 0 | 1 | 2 | 3

export interface SettingsStore {
  // ─── Worklog settings ──────────────────────────────
  /** Most-recently-used Jira issues (key + optional summary), most recent first. Max MAX_RECENT_ISSUES entries. */
  recentJiraIssues: RecentJiraIssue[]
  /** Target working hours per day. Used for worklog colour thresholds. Default: 8. */
  workingDayHours: number

  // ─── Appearance ────────────────────────────────────
  theme: AppTheme
  language: AppLanguage

  // ─── Agent settings ────────────────────────────────
  /** Maximum autonomy level the user allows for agents. Default: 1 (proposals only). */
  maxAgentAutonomyLevel: AgentAutonomyLevel

  // ─── Notifications ─────────────────────────────────
  notificationsEnabled: boolean

  // ─── Signatures ────────────────────────────────────
  /** Informal signature appended to Slack draft replies. */
  slackSignature: string
  /** Formal signature appended to Gmail draft replies. */
  emailSignature: string

  // ─── Time savings ──────────────────────────────────
  timeSavingsSecondsPerScan: number
  timeSavingsSecondsPerMessage: number
  timeSavingsSecondsPerAutoRead: number
  timeSavingsSecondsPerMarkRead: number
  timeSavingsSecondsPerWorklog: number

  // ─── Actions ───────────────────────────────────────
  /**
   * Prepend an issue key to the recent list if it is not already present.
   * Trims the list to MAX_RECENT_ISSUES.
   */
  addRecentJiraIssue: (key: string, summary?: string) => void
  /** Update the summary of an existing recent issue without changing its position. */
  updateRecentJiraIssueSummary: (key: string, summary: string) => void
  /** Remove all recent Jira issues (e.g. on logout). */
  clearRecentJiraIssues: () => void
  /** Set working day length in hours. Clamped to [1, 24]. */
  setWorkingDayHours: (hours: number) => void
  setTheme: (theme: AppTheme) => void
  setLanguage: (language: AppLanguage) => void
  setMaxAgentAutonomyLevel: (level: AgentAutonomyLevel) => void
  setNotificationsEnabled: (enabled: boolean) => void
  setSlackSignature: (sig: string) => void
  setEmailSignature: (sig: string) => void
  setTimeSavingsSecondsPerScan: (s: number) => void
  setTimeSavingsSecondsPerMessage: (s: number) => void
  setTimeSavingsSecondsPerAutoRead: (s: number) => void
  setTimeSavingsSecondsPerMarkRead: (s: number) => void
  setTimeSavingsSecondsPerWorklog: (s: number) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // Defaults
      recentJiraIssues: [],
      workingDayHours: 8,
      theme: 'dark',
      language: 'cs',
      maxAgentAutonomyLevel: 1,
      notificationsEnabled: true,
      slackSignature: '',
      emailSignature: '',
      timeSavingsSecondsPerScan: 30,
      timeSavingsSecondsPerMessage: 30,
      timeSavingsSecondsPerAutoRead: 5,
      timeSavingsSecondsPerMarkRead: 5,
      timeSavingsSecondsPerWorklog: 10,

      // Actions
      addRecentJiraIssue: (key, summary) =>
        set((state) => {
          const normalised = key.trim().toUpperCase()
          if (!normalised) return state
          const existing = state.recentJiraIssues.find((item) => item.key === normalised)
          const filtered = state.recentJiraIssues.filter((item) => item.key !== normalised)
          return {
            recentJiraIssues: [{
              key: normalised,
              summary: summary ?? existing?.summary,
            }, ...filtered].slice(0, MAX_RECENT_ISSUES),
          }
        }),

      updateRecentJiraIssueSummary: (key, summary) =>
        set((state) => ({
          recentJiraIssues: state.recentJiraIssues.map((item) =>
            item.key === key.trim().toUpperCase() ? { ...item, summary } : item,
          ),
        })),

      clearRecentJiraIssues: () => set({ recentJiraIssues: [] }),

      setWorkingDayHours: (hours) =>
        set({ workingDayHours: Math.min(24, Math.max(1, Math.round(hours))) }),

      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setMaxAgentAutonomyLevel: (level) => set({ maxAgentAutonomyLevel: level }),
      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
      setSlackSignature: (sig) => set({ slackSignature: sig }),
      setEmailSignature: (sig) => set({ emailSignature: sig }),
      setTimeSavingsSecondsPerScan: (s) => set({ timeSavingsSecondsPerScan: Math.max(0, s) }),
      setTimeSavingsSecondsPerMessage: (s) => set({ timeSavingsSecondsPerMessage: Math.max(0, s) }),
      setTimeSavingsSecondsPerAutoRead: (s) => set({ timeSavingsSecondsPerAutoRead: Math.max(0, s) }),
      setTimeSavingsSecondsPerMarkRead: (s) => set({ timeSavingsSecondsPerMarkRead: Math.max(0, s) }),
      setTimeSavingsSecondsPerWorklog: (s) => set({ timeSavingsSecondsPerWorklog: Math.max(0, s) }),
    }),
    {
      name: 'houston-settings',
      version: 1,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>
        if (version === 0 && Array.isArray(state.recentJiraIssues)) {
          state.recentJiraIssues = (state.recentJiraIssues as unknown[]).map((item) =>
            typeof item === 'string' ? { key: item } : item,
          )
        }
        return state
      },
      // Only persist state – actions are excluded automatically by Zustand persist
      partialize: (state) => ({
        recentJiraIssues: state.recentJiraIssues,
        workingDayHours: state.workingDayHours,
        theme: state.theme,
        language: state.language,
        maxAgentAutonomyLevel: state.maxAgentAutonomyLevel,
        notificationsEnabled: state.notificationsEnabled,
        slackSignature: state.slackSignature,
        emailSignature: state.emailSignature,
        timeSavingsSecondsPerScan: state.timeSavingsSecondsPerScan,
        timeSavingsSecondsPerMessage: state.timeSavingsSecondsPerMessage,
        timeSavingsSecondsPerAutoRead: state.timeSavingsSecondsPerAutoRead,
        timeSavingsSecondsPerMarkRead: state.timeSavingsSecondsPerMarkRead,
        timeSavingsSecondsPerWorklog: state.timeSavingsSecondsPerWorklog,
      }),
    },
  ),
)
