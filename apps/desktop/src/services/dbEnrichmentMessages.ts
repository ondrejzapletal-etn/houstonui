export type DbEnrichmentEntityType = 'project' | 'client' | 'issue'
export type DbEnrichmentAction = 'created' | 'updated'

export const DB_ENRICHMENT_MESSAGES: Record<DbEnrichmentEntityType, Partial<Record<DbEnrichmentAction, (label: string) => string>>> = {
  project: {
    created: (label) => `Nový projekt "${label}" byl přidán do databáze.`,
    updated: (label) => `Projekt "${label}" byl aktualizován.`,
  },
  client: {
    created: (label) => `Nový klient "${label}" byl přidán do databáze.`,
    updated: (label) => `Klient "${label}" byl aktualizován.`,
  },
  issue: {
    created: (label) => `Issue "${label}" bylo přidáno do databáze.`,
    updated: (label) => `Issue "${label}" bylo aktualizováno.`,
  },
}

export function buildDbEnrichmentMessage(entity: DbEnrichmentEntityType, action: DbEnrichmentAction, label: string): string {
  return DB_ENRICHMENT_MESSAGES[entity]?.[action]?.(label) ?? `${entity} "${label}" byl změněn.`
}
