/** Shared types for the Houston Task (natural language orchestration) feature. */
import type { ScanProposalData } from './scan';
export interface TaskExecuteRequest {
    request: string;
    language?: string;
    allowLiveData?: boolean;
}
export interface TaskProgressEvent {
    type: 'progress';
    phase: string;
    message: string;
}
export interface TaskLogEvent {
    type: 'log';
    message: string;
}
export interface TaskResultEvent {
    type: 'result';
    content: string;
}
export interface TaskProposalEvent {
    type: 'proposal';
    proposal: ScanProposalData;
}
export interface TaskCompletedEvent {
    type: 'completed';
    summary: {
        proposalCount: number;
    };
}
export interface TaskErrorEvent {
    type: 'error';
    message: string;
}
export type TaskEvent = TaskProgressEvent | TaskLogEvent | TaskResultEvent | TaskProposalEvent | TaskCompletedEvent | TaskErrorEvent;
//# sourceMappingURL=task.d.ts.map