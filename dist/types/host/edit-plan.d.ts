/** Exact history selection for editing a human-authored message. */
import type { MessageId } from '@deepseek-ai/dsh-llm/brand';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
/** A validated edit retains earlier messages and existing non-text attachments. */
export interface EditPlan {
    readonly beforeSeq: number;
    readonly turn: number;
    readonly content: UserMessage['content'];
}
/**
 * Select the prefix before a human message, including a zero-length first-turn prefix.
 * @param events - canonical source events, starting at zero.
 * @param messageId - durable human message being edited.
 * @param text - replacement text; attachments retain their original order.
 * @returns the prefix, source turn, and replacement contents, or no human target.
 */
export declare function planMessageEdit(events: readonly SessionEvent[], messageId: MessageId, text: string): EditPlan | undefined;
