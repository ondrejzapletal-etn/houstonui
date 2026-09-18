/**
 * Hardcoded scan agent definition for v1.
 * In a future version this will be persisted in the DB as AgentDefinition.
 * See docs/03-agent-model.md for the full agent model spec.
 */

export const SCAN_AGENT = {
  id: 'houston-scan-v1',
  name: 'Houston Scan',
  description: 'Scans all connected sources, classifies items, and generates actionable proposals.',
  autonomyLevel: 1, // Level 1 = suggestions only, no auto-execution
  allowedSources: ['gmail', 'slack', 'jira', 'calendar', 'clockify'] as const,
  allowedTools: [
    'read_email',
    'read_slack',
    'read_calendar',
    'read_jira',
    'generate_summary',
    'propose_reply',
    'classify_message',
  ] as const,
  status: 'active' as const,
} as const
