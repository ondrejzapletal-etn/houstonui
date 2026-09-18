import { Injectable, Logger } from '@nestjs/common'
import { AiGatewayService } from '../ai-gateway/ai-gateway.service'

export interface TaskIntent {
  topic: string
  intentType: 'summarize' | 'find' | 'analyze' | 'prepare' | 'action'
  entities: string[]
  keywords: string[]
  needsFreshData: boolean
  sources: string[]
  outputDescription: string
  actionType?: 'add_client' | 'create_task' | 'add_entity'
  actionParams?: Record<string, string>
}

const SYSTEM_PROMPT = `You are Houston's intent analyzer. Extract structured intent from a user's natural language task request.

Return ONLY a valid JSON object with these exact fields:
{
  "topic": "main subject of the request (project name, person, issue, etc.)",
  "intentType": "summarize" | "find" | "analyze" | "prepare" | "action",
  "entities": ["specific names to look for: project names, people, issue keys like PROJ-123"],
  "keywords": ["broader search terms for knowledge graph, 3-8 terms"],
  "needsFreshData": true or false,
  "sources": ["kg", "recent_scans"] or also include "gmail", "slack", "calendar" if live data is useful,
  "outputDescription": "short description of what the response should contain"
}

For intentType "action" also include these additional fields:
{
  "actionType": "add_client" | "create_task" | "add_entity",
  "actionParams": { "name": "...", ...other params }
}

intentType rules:
- "action": imperative commands that directly mutate the knowledge base (přidej, vytvoř, zaregistruj, add, create, register):
  - "add_client": "přidej klienta X", "add client X", "zaregistruj firmu X", "přidej zákazníka X"
    actionParams: { "name": "X", "domain"?: "x.com", "notes"?: "..." }
  - "create_task": "vytvoř úkol X", "přidej task X", "vytvoř task X v projektu Y", "create task X"
    actionParams: { "name": "X", "projectName"?: "Y", "description"?: "..." }
  - "add_entity": "přidej osobu X", "přidej entitu X", "zaznamenej organizaci X", "přidej kontakt X"
    actionParams: { "name": "X", "type"?: "person|organization|artifact|project", "description"?: "..." }
  For action intent: needsFreshData = false, sources = ["kg"], actionParams must contain at least "name"
- "summarize": summarize/overview requests
- "find": search/lookup requests
- "analyze": analysis/comparison requests
- "prepare": preparation/planning requests

Other rules:
- needsFreshData = true when the request depends on current or time-relative connector data (e.g. "what arrived today", "latest updates", "tomorrow's meeting", "Tuesday's schedule")
- sources always includes "kg" and "recent_scans"; add "gmail" or "slack" only when live messages would materially improve the answer; add "calendar" for project status, meeting summaries, or scheduling requests
- entities: extract specific names/keys actually mentioned in the request
- keywords: derive broader terms useful for graph search, not just repeating entities`

@Injectable()
export class TaskIntentAnalyzerService {
  private readonly logger = new Logger(TaskIntentAnalyzerService.name)

  constructor(private readonly ai: AiGatewayService) {}

  async analyze(userId: string, request: string, allowLiveData: boolean): Promise<TaskIntent> {
    const userPrompt = `User request: "${request}"\nAllow live connector data: ${allowLiveData}`

    const response = await this.ai.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { jsonMode: true, temperature: 0.1, userId },
    )

    const parsed = JSON.parse(response) as TaskIntent
    this.logger.debug(`Intent: ${parsed.intentType} / "${parsed.topic}" / keywords=${parsed.keywords.join(',')}`)

    if (!allowLiveData) {
      parsed.sources = (parsed.sources ?? []).filter((s) => s === 'kg' || s === 'recent_scans')
      parsed.needsFreshData = false
    }

    return parsed
  }
}
