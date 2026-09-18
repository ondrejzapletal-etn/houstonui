import { Injectable, Logger } from '@nestjs/common'
import { ProposalStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { TaskIntentAnalyzerService } from './task-intent-analyzer.service'
import { TaskContextBuilderService } from './task-context-builder.service'
import { TaskResponseGeneratorService } from './task-response-generator.service'
import type { TaskEvent } from './dto/task-event.dto'

export { TaskEvent }

@Injectable()
export class TaskOrchestratorService {
  private readonly logger = new Logger(TaskOrchestratorService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly intentAnalyzer: TaskIntentAnalyzerService,
    private readonly contextBuilder: TaskContextBuilderService,
    private readonly responseGenerator: TaskResponseGeneratorService,
  ) {}

  async *runTask(
    userId: string,
    request: string,
    allowLiveData: boolean,
    language?: string,
  ): AsyncGenerator<TaskEvent> {
    this.audit.log('task.started', { userId, metadata: { request: request.slice(0, 200) } })
    this.logger.log(`Task started for user=${userId}: "${request.slice(0, 80)}"`)

    // Phase 1: Intent analysis
    yield { type: 'progress', phase: 'analyze', message: 'Analyzing your request…' }

    let intent: Awaited<ReturnType<TaskIntentAnalyzerService['analyze']>>
    try {
      intent = await this.intentAnalyzer.analyze(userId, request, allowLiveData)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: `Intent analysis failed: ${message}` }
      return
    }

    // Phase 1.5: Direct knowledge action – create proposal without LLM
    if (intent.intentType === 'action') {
      yield { type: 'progress', phase: 'execute', message: 'Připravuji akci…' }

      const actionType = intent.actionType
      const params = intent.actionParams ?? {}
      const name = params['name'] ?? intent.topic

      const summaryMap: Record<string, string> = {
        add_client: `Přidat klienta: ${name}`,
        create_task: `Vytvořit úkol: ${name}${params['projectName'] ? ` (projekt: ${params['projectName']})` : ''}`,
        add_entity: `Přidat entitu: ${name}`,
      }
      const summary = summaryMap[actionType ?? ''] ?? `Akce: ${name}`

      const detailMap: Record<string, string> = {
        add_client: `Vytvoří nového klienta „${name}"${params['domain'] ? ` s doménou ${params['domain']}` : ''} v knowledge bázi.`,
        create_task: `Vytvoří task entitu „${name}" v knowledge grafu${params['projectName'] ? ` a propojí ji s projektem „${params['projectName']}"` : ''}.`,
        add_entity: `Přidá entitu typu „${params['type'] ?? 'artifact'}" s názvem „${name}" do knowledge grafu.`,
      }
      const detail = detailMap[actionType ?? ''] ?? `Provede akci: ${name}`

      try {
        const proposal = await this.prisma.proposal.create({
          data: {
            userId,
            system: 'knowledge',
            tier: 1,
            summary,
            detail,
            draft: JSON.stringify({ actionType, ...params }),
            status: ProposalStatus.PENDING,
          },
        })

        const resultMsg = (language ?? 'cs') === 'cs'
          ? `Připravena akce k potvrzení. Zkontrolujte návrh níže a klikněte **Provést**.`
          : `Action ready for confirmation. Review the proposal below and click **Execute**.`
        yield { type: 'result', content: resultMsg }
        yield {
          type: 'proposal',
          proposal: {
            id: proposal.id,
            system: proposal.system,
            tier: proposal.tier,
            summary: proposal.summary,
            detail: proposal.detail ?? undefined,
          },
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        yield { type: 'error', message: `Nepodařilo se připravit akci: ${message}` }
        return
      }

      this.audit.log('task.action_proposal', { userId, metadata: { actionType, request: request.slice(0, 200) } })
      this.logger.log(`Task action_proposal for user=${userId}: actionType=${actionType ?? 'unknown'}`)
      yield { type: 'completed', summary: { proposalCount: 1 } }
      return
    }

    // Phase 2: Context building
    const hasLiveSource = (intent.sources ?? []).some(
      (source) => source !== 'kg' && source !== 'recent_scans',
    )
    const liveNote = allowLiveData && (intent.needsFreshData || hasLiveSource) ? ' + fetching live data…' : ''
    yield {
      type: 'progress',
      phase: 'context',
      message: `Building context from knowledge graph${liveNote}`,
    }

    let context: Awaited<ReturnType<TaskContextBuilderService['build']>>
    try {
      context = await this.contextBuilder.build(userId, intent, allowLiveData)
      const liveDataNote = context.liveData ? ' (+ live data)' : ''
      yield {
        type: 'log',
        message: `Found ${context.entities.length} KG entities, ${context.recentProposals.length} recent proposals, ${context.cachedIssues.length} Jira issues${liveDataNote}`,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: `Context build failed: ${message}` }
      return
    }

    // Phase 3: Response generation
    yield { type: 'progress', phase: 'generate', message: 'Generating response…' }

    let response: Awaited<ReturnType<TaskResponseGeneratorService['generate']>>
    try {
      response = await this.responseGenerator.generate(userId, request, intent, context, language)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: `Response generation failed: ${message}` }
      return
    }

    // Emit the markdown result
    yield { type: 'result', content: response.summary }

    // Phase 4: Persist proposals
    let proposalCount = 0
    for (const draft of response.proposals) {
      try {
        const tier = draft.tier === 1 || draft.tier === 2 ? draft.tier : 2
        const proposal = await this.prisma.proposal.create({
          data: {
            userId,
            scanRunId: null,
            system: draft.system ?? 'task',
            tier,
            summary: draft.summary,
            detail: draft.detail ?? null,
            draft: draft.draft ?? null,
            issueKey: draft.issueKey ?? null,
            confidence: typeof draft.confidence === 'number' ? draft.confidence : null,
            status: ProposalStatus.PENDING,
          },
        })
        proposalCount++
        yield {
          type: 'proposal',
          proposal: {
            id: proposal.id,
            system: proposal.system,
            tier: proposal.tier,
            summary: proposal.summary,
            detail: proposal.detail ?? undefined,
            draft: proposal.draft ?? undefined,
            issueKey: proposal.issueKey ?? undefined,
            confidence: proposal.confidence ?? undefined,
          },
        }
      } catch (err: unknown) {
        this.logger.error(
          `Failed to save task proposal: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    this.audit.log('task.completed', { userId, metadata: { proposalCount } })
    this.logger.log(`Task completed for user=${userId}: ${proposalCount} proposals`)
    yield { type: 'completed', summary: { proposalCount } }
  }
}
