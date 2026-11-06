/** Exact history selection for editing a human-authored message. */
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** A validated edit retains earlier messages and existing non-text attachments. */
export interface EditPlan {
  readonly beforeSeq: number
  readonly turn: number
  readonly content: UserMessage['content']
}

/**
 * Select the prefix before a human message, including a zero-length first-turn prefix.
 * @param events - canonical source events, starting at zero.
 * @param messageId - durable human message being edited.
 * @param text - replacement text; attachments retain their original order.
 * @returns the prefix, source turn, and replacement contents, or no human target.
 */
export function planMessageEdit(events: readonly SessionEvent[], messageId: MessageId, text: string): EditPlan | undefined {
  let turn = 0, turnStart = 0, humanInTurn = false
  for (const event of events) {
    if (event.type === 'turn/start') { turn = event.data.turn; turnStart = event.seq; humanInTurn = false }
    if (event.type !== 'user/message' || event.surfaceOp !== 'append' || event.data.source.kind !== 'user') continue
    if (event.data.id !== messageId) { humanInTurn = true; continue }
    let inserted = false
    const content: UserMessage['content'][number][] = []
    for (const block of event.data.content) {
      if (block.type !== 'text') content.push(block)
      else if (!inserted) { inserted = true; content.push({ type: 'text', text }) }
    }
    if (!inserted) content.unshift({ type: 'text', text })
    return { beforeSeq: humanInTurn ? event.seq : turnStart, turn, content }
  }
  return undefined
}
