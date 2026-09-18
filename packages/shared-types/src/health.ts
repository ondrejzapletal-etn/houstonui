export interface HealthData {
  status: 'ok' | 'degraded' | 'error'
  timestamp: string
  version: string
}
