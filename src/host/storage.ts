/** Non-model annotations and version relationships, stored outside immutable transcripts. */
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const sessionId = z.string().min(1).transform(SessionId)
const editRecord = z.object({
  sourceSessionId: sessionId,
  childSessionId: sessionId,
  fingerprint: z.string(),
  createdAt: z.number().int().nonnegative(),
})
/** Persisted identity of one editing submission. */
export type EditRecord = z.infer<typeof editRecord>
/** Sidecar metadata is invisible to the model and does not rewrite Session events. */
export const conversationToolsDomain = defineDomain({
  name: 'conversation_tools', version: 1,
  tables: {
    stars: domainTable<SessionId, { turns: number[] }>(z.object({ turns: z.array(z.number().int().nonnegative()) })),
    edits: domainTable(editRecord),
  },
})
