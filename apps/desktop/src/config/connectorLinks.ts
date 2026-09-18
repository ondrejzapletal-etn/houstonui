import type { ConnectorType } from '@houston/shared-types'

/**
 * Web adresa každého zdroje pro odkaz „Otevřít v prohlížeči" v náhledovém modálu.
 *
 * Jira je záměrně generická: konkrétní `<site>.atlassian.net` zná jen backend
 * (přes cloudId / externalAccountId), `start.atlassian.net` uživatele přesměruje
 * na jeho instanci.
 */
export const CONNECTOR_WEB_URLS: Partial<Record<ConnectorType, string>> = {
  gmail: 'https://mail.google.com',
  slack: 'https://app.slack.com/client',
  jira: 'https://start.atlassian.net',
  clockify: 'https://app.clockify.me/tracker',
  hotspot: 'https://hot.etn.cz',
}
