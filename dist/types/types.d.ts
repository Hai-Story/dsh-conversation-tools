/** Public conversation bookmarks and retained edit versions. */
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { MessageId } from '@deepseek-ai/dsh-llm/brand';
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types';
/** A preserved conversation version; opening it never modifies its history. */
export interface ConversationVersion {
    readonly sessionId: SessionId;
    readonly createdAt: number;
}
/** Host-owned annotations shared by every view of a Session. */
export interface ConversationToolsSnapshot {
    readonly starredTurns: readonly number[];
    readonly versions: readonly ConversationVersion[];
}
/** Explicit bookmark state, safe to retry without toggling twice. */
export interface StarTurnRequest {
    readonly sessionId: SessionId;
    readonly turn: number;
    readonly starred: boolean;
}
/** One editing submission. Retries retain the request identity and the exact text. */
export interface EditMessageRequest {
    readonly sessionId: SessionId;
    readonly messageId: MessageId;
    readonly requestId: SessionRequestId;
    readonly text: string;
    /** Known child from a partial edit; never create a replacement if its relationship is unavailable. */
    readonly recoverySessionId?: SessionId;
}
/** Durable link to the edited version, independent of generation completion. */
export interface EditMessageResult {
    readonly sessionId: SessionId;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        /** Invalid target, concurrent work, or an incompatible retry. */
        'conversationTools/rejected': {
            reason: 'empty' | 'missing-message' | 'busy' | 'request-conflict' | 'persistence-unavailable' | 'recovery-unavailable';
        };
        /** A child exists; the original and the new version both remain recoverable. */
        'conversationTools/incomplete': {
            sessionId: SessionId;
            phase: 'link' | 'submission';
        };
    }
}
