/** Failed edit tickets stay in this browser tab; no message text is sent to logging services. */
import { z } from 'zod'
import type { DraftSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EditingDraft } from './controller.ts'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'

const document = z.object({
  text: z.string(), references: z.array(z.object({ source: z.string(), ref: z.string(), label: z.string(),
    clipboardText: z.string(), offset: z.number().int().nonnegative(), length: z.number().int().nonnegative(),
    appearance: z.enum(['session', 'file', 'folder']).optional(), invalid: z.boolean().optional() })),
  command: z.object({ token: z.string() }).optional(),
  quotes: z.array(z.object({ offset: z.number().int().nonnegative(), length: z.number().int().nonnegative(), text: z.string() })).optional(),
})
const ticket = z.object({
  draft: z.object({ messageId: z.string().min(1).transform(MessageId), text: z.string(),
    requestId: z.string().min(1).transform(value => value as SessionRequestId),
    recoverableSessionId: z.string().min(1).transform(SessionId),
    failure: z.enum(['submit', 'busy', 'persistence', 'partial', 'recovery-unavailable']) }),
  previous: document.optional(),
})
export interface RecoveryTicket { draft: EditingDraft; previous?: DraftSnapshot }
export interface RecoveryStore { read(): RecoveryTicket | undefined; write(value: RecoveryTicket | undefined): void }

/** Browser storage is optional; denied/quota-failed writes leave the in-memory draft intact. */
export function recoveryStore(sessionId: string, report: (error: unknown) => void): RecoveryStore {
  const key = `dsh.conversation-tools.recovery.${sessionId}`
  return {
    read() {
      try {
        if (typeof sessionStorage === 'undefined') return undefined
        const raw = sessionStorage.getItem(key)
        if (raw === null) return undefined
        const value = ticket.parse(JSON.parse(raw))
        return { draft: { ...value.draft, pending: false, failed: true },
          ...(value.previous === undefined ? {} : { previous: value.previous as DraftSnapshot }) }
      } catch (error) { report(error); return undefined }
    },
    write(value) {
      try {
        if (typeof sessionStorage === 'undefined') return
        if (value === undefined) sessionStorage.removeItem(key)
        else sessionStorage.setItem(key, JSON.stringify(value))
      } catch (error) { report(error) }
    },
  }
}
