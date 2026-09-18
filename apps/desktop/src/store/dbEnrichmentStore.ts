import { create } from 'zustand'
import type { DbEnrichmentEntityType, DbEnrichmentAction } from '../services/dbEnrichmentMessages'

export interface DbEnrichmentNotification {
  id: string
  entityType: DbEnrichmentEntityType
  action: DbEnrichmentAction
  label: string
  message: string
}

interface DbEnrichmentStore {
  notifications: DbEnrichmentNotification[]
  push: (n: Omit<DbEnrichmentNotification, 'id'>) => void
  dismiss: (id: string) => void
}

export const useDbEnrichmentStore = create<DbEnrichmentStore>((set) => ({
  notifications: [],
  push: (n) => set((s) => ({ notifications: [...s.notifications, { ...n, id: crypto.randomUUID() }] })),
  dismiss: (id) => set((s) => ({ notifications: s.notifications.filter((x) => x.id !== id) })),
}))
