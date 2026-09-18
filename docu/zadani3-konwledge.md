1. ENTITY (core identity layer)
Entity {
  id: string,
  type: "person | task | project | conversation | artifact | organization | system_object",
  title: string,
  description?: string,

  created_at: datetime,
  updated_at: datetime,

  status?: "active | closed | archived",

  metadata: {
    priority?: number,
    tags?: string[]
  }
}
2. OBSERVATION (vstup z jakéhokoliv systému)
Observation {
  id: string,

  source_system: string,        // generický string (NE Gmail/Slack type)
  source_type: string,          // "message | event | record | change"

  source_ref: string,           // externí ID

  timestamp: datetime,

  actor_external_id?: string,

  content: string,

  raw_payload: json,

  extracted_signals?: {
    entities_mentioned?: string[],
    sentiment?: number,
    urgency?: number
  }
}

👉 důležité: source_system je jen string, ne typový model

3. EXTERNAL LINK (mapping vrstva)
ExternalLink {
  entity_id: string,

  system: string,          // opět generický string
  external_id: string,     // ID v cizím systému

  external_type?: string,  // optional classification

  last_seen_at: datetime
}
4. RELATION (graph layer)
Relation {
  id: string,

  from_entity_id: string,
  to_entity_id: string,

  type: "RELATED_TO | PART_OF | BLOCKS | DEPENDS_ON | MENTIONS | DERIVED_FROM",

  confidence: float,

  weight?: float,

  created_at: datetime,

  derived_from_observation_id?: string
}
5. EVENT (append-only truth layer)
Event {
  id: string,

  timestamp: datetime,

  type: string,          // generický: "entity_created", "relation_added", "status_changed"

  actor_entity_id?: string,

  related_entity_ids: string[],

  payload: json
}
6. FACTS (current state layer)
Fact {
  entity_id: string,

  key: string,          // např. "priority", "owner", "risk_score"
  value: json,

  confidence: float,

  source: string,       // "inferred | user | system"

  updated_at: datetime
}
7. DERIVED STATE (AI working memory)
DerivedState {
  entity_id: string,

  computed_at: datetime,

  summary: string,

  insights: string[],

  risk_score?: number,
  urgency_score?: number,

  related_entities: string[]
}
8. VIEW (UI / HTML generace)
View {
  id: string,

  type: "project_view | client_view | incident_view | personal_dashboard",

  root_entity_id: string,

  sections: [
    {
      type: string,
      entity_ids: string[],
      config?: json
    }
  ],

  generated_at: datetime
}
🧠 KLÍČOVÉ ARCHITEKTONICKÉ GARANCE
✔️ 1. 100% agnostic core

Žádný Slack/Gmail/Jira v entitách

✔️ 2. všechny integrace jsou jen observations

Externí systémy jsou „senzory“

✔️ 3. entity nikdy neobsahují „real-world provider semantics“
✔️ 4. AI pracuje jen s:
entity subgraph
facts
derived state

ne s raw data

✔️ 5. scan = ingestion, ne business logika