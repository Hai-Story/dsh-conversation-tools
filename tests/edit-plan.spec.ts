import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createAssistantMessage, createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { planMessageEdit } from '../src/host/edit-plan.ts'

function conversation() {
  const session = Session.create(SessionId('edit-plan'))
  const messages = ['first', 'second', 'third'].map(text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  for (const [index, message] of messages.entries()) {
    session.append('turn/start', { turn: index + 1 })
    session.append('user/message', message, { surfaceOp: 'append' })
    session.append('assistant/message', { turn: index + 1, step: 1, stream: [], message: createAssistantMessage({
      content: [{ type: 'text', text: `answer-${index + 1}` }], source: { provider: 'fixture', model: 'fixture' },
    }) }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: index + 1, reason: { kind: 'completed' } })
  }
  return { session, messages, events: session.snapshotEvents() }
}

describe('retained edit history', () => {
  it('allows editing the first message with no previous turn', () => {
    const { events, messages } = conversation()
    expect(planMessageEdit(events, messages[0]!.id, 'replacement')).toMatchObject({ beforeSeq: 0, turn: 1, content: [{ type: 'text', text: 'replacement' }] })
  })
  it('excludes the edited turn and every later reply without changing the original', () => {
    const { events, messages } = conversation()
    const saved = JSON.stringify(events)
    const plan = planMessageEdit(events, messages[1]!.id, 'replacement')!
    expect(JSON.stringify(events.slice(0, plan.beforeSeq))).toContain('answer-1')
    expect(JSON.stringify(events.slice(0, plan.beforeSeq))).not.toContain('answer-2')
    expect(JSON.stringify(events)).toBe(saved)
    expect(planMessageEdit(events, MessageId('missing'), 'replacement')).toBeUndefined()
  })
  it('cuts an admitted steering input at its own position and preserves the preceding human message', () => {
    const session = Session.create(SessionId('steering-edit'))
    session.append('turn/start', { turn: 1 })
    const original = createUserMessage({ content: [{ type: 'text', text: 'opening' }], source: { kind: 'user' } })
    session.append('user/message', original, { surfaceOp: 'append' })
    const steering = createUserMessage({ content: [{ type: 'text', text: 'steering' }], source: { kind: 'user' } })
    const target = session.append('user/message', steering, { surfaceOp: 'append' })
    expect(planMessageEdit(session.snapshotEvents(), steering.id, 'changed')?.beforeSeq).toBe(target.seq)
  })
  it('keeps attachment identities and order while replacing all text blocks', () => {
    const session = Session.create(SessionId('attachment-edit'))
    const attachment: Extract<UserMessage['content'][number], { type: 'file' }> = {
      type: 'file', attachment: { name: 'notes.txt', bytes: 5,
        attachmentId: 'file-ref' as Extract<UserMessage['content'][number], { type: 'file' }>['attachment']['attachmentId'] },
    }
    const message = createUserMessage({ content: [{ type: 'text', text: 'before' }, attachment, { type: 'text', text: 'after' }],
      source: { kind: 'user' } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', message, { surfaceOp: 'append' })
    expect(planMessageEdit(session.snapshotEvents(), message.id, 'edited')?.content)
      .toEqual([{ type: 'text', text: 'edited' }, attachment])
  })

})
