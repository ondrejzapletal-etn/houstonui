/**
 * Centralizovaná konfigurace backend API.
 * URL se čte z import.meta.env (Vite env vars) s fallbackem na localhost pro dev.
 */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000/api/v1'
