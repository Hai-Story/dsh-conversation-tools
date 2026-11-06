import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import ConversationTools from '../src/host/index.ts'
import type { EditRecord } from '../src/host/storage.ts'
import { TYPERT_REMOTE } from '../src/protocol/remote.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); vi.restoreAllMocks() })

it('carries the recovery child through strict wire validation', () => {
  const request = { sessionId: 'source', messageId: 'message', requestId: 'request', text: 'replacement', recoverySessionId: 'child' }
  const schema = TYPERT_REMOTE.methods['conversationTools/edit'].input({ strict: true }).create()
  expect(schema.parse({ request })).toEqual({ request })
})

function table<T>() {
  const rows = new Map<string, T>()
  return { get: (id: string) => rows.get(id), entries: () => rows.entries(),
    put: vi.fn(async (id: string, value: T) => { rows.set(id, value) }),
    update: async (id: string, update: (value: T) => T) => { rows.set(id, update(rows.get(id)!)) } }
}

async function fixture() {
  const ctx = new Context()
  const edits = table<EditRecord>(), stars = table<{ turns: number[] }>()
  const sourceSession = Session.create(SessionId('source'))
  const message = createUserMessage({ content: [{ type: 'text', text: 'original' }], source: { kind: 'user' } })
  sourceSession.append('turn/start', { turn: 1 })
  sourceSession.append('user/message', message, { surfaceOp: 'append' })
  const agent = (session: Session) => ({ id: session.id, session, status: 'idle',
    runMaintenance: vi.fn(async (task: () => Promise<unknown>) => task()), whenIdle: vi.fn(async () => {}),
    inbox: { clear: vi.fn() }, model: { current: () => undefined, select: vi.fn() },
    followup: vi.fn((input: UserMessage) => session.append('user/message', input, { surfaceOp: 'append' })) })
  const source = agent(sourceSession)
  const agents = new Map([[source.id, source]])
  const create = vi.fn(async () => {
    const child = agent(Session.create(SessionId(`child-${agents.size}`)))
    agents.set(child.id, child)
    return { sessionId: child.id }
  })
  const flush = vi.fn(async (_session: Session) => true)
  const cancel = vi.fn()
  ctx.provide('storageDomain', { open: async () => ({ table: (name: string) => name === 'edits' ? edits : stars, close: async () => {} }) })
  ctx.provide('sessions', { flush })
  ctx.provide('sessionController', { resolveAgent: async (id: string) => ({ agent: agents.get(SessionId(id))! }), create, fork: create, cancel })
  ctx.provide('sessionQuery', { observeSession: async (id: string) => ({ events: agents.get(SessionId(id))!.session.snapshotEvents(), [Symbol.dispose]() {} }) })
  ctx.provide('workingDirectory', { get: () => '/fixture-workspace', set: vi.fn(async () => {}) })
  ctx.provide('remoteAccess', { allows: () => true })
  ctx.provide('workspaceRegistry', { list: () => [] })
  ctx.provide('permissionPresets', { current: () => 'read-only', set: vi.fn() })
  let fiber = await ctx.plugin(ConversationTools)
  cleanup.push(() => fiber.dispose())
  const request = { sessionId: source.id, messageId: message.id, requestId: 'edit-request' as SessionRequestId, text: 'replacement' }
  return { get service() { return ctx.conversationTools }, request, source, agents, create, flush, cancel, edits,
    restart: async () => { await fiber.dispose(); fiber = await ctx.plugin(ConversationTools) } }
}

it('rejects absent durability before creating a child or interrupting the source', async () => {
  const f = await fixture()
  f.source.status = 'running'
  f.flush.mockResolvedValueOnce(false)
  await expect(f.service.edit(f.request)).rejects.toMatchObject({ code: 'conversationTools/rejected', details: { reason: 'persistence-unavailable' } })
  expect(f.create).not.toHaveBeenCalled()
  expect(f.cancel).not.toHaveBeenCalled()
})

it('preserves a real persistence exception instead of classifying it as missing listeners', async () => {
  const f = await fixture()
  const error = new Error('Disk write failed')
  f.flush.mockRejectedValueOnce(error)
  await expect(f.service.edit(f.request)).rejects.toBe(error)
  expect(f.create).not.toHaveBeenCalled()
})

it('classifies synchronous maintenance contention and preserves its cause', async () => {
  const f = await fixture()
  const error = new Error('Maintenance is already active')
  f.source.runMaintenance.mockImplementationOnce(() => { throw error })
  await expect(f.service.edit(f.request)).rejects.toMatchObject({ code: 'conversationTools/rejected', details: { reason: 'busy' }, cause: error })
  expect(f.create).not.toHaveBeenCalled()
})

it('repairs a failed version link and submits exactly once to the original child', async () => {
  const f = await fixture()
  const error = new Error('Sidecar write failed')
  f.edits.put.mockRejectedValueOnce(error)
  await expect(f.service.edit(f.request)).rejects.toMatchObject({ code: 'conversationTools/incomplete', details: { sessionId: 'child-1', phase: 'link' }, cause: error })
  expect(f.service.snapshot(f.source.id).versions).toHaveLength(1)
  const retry = { ...f.request, recoverySessionId: SessionId('child-1') }
  await expect(f.service.edit(retry)).resolves.toEqual({ sessionId: 'child-1' })
  await expect(f.service.edit(retry)).resolves.toEqual({ sessionId: 'child-1' })
  expect(f.create).toHaveBeenCalledOnce()
  expect(f.agents.get(SessionId('child-1'))!.followup).toHaveBeenCalledOnce()
  expect(f.service.snapshot(f.source.id).versions).toHaveLength(2)
})

it('does not create another child when a failed link cannot be recovered after restart', async () => {
  const f = await fixture()
  f.edits.put.mockRejectedValueOnce(new Error('Sidecar unavailable'))
  await expect(f.service.edit(f.request)).rejects.toMatchObject({ code: 'conversationTools/incomplete' })
  await f.restart()
  await expect(f.service.edit({ ...f.request, recoverySessionId: SessionId('child-1') })).rejects.toMatchObject({
    code: 'conversationTools/rejected', details: { reason: 'recovery-unavailable' } })
  expect(f.create).toHaveBeenCalledOnce()
})

it('retries a child checkpoint without sending a duplicate edited message', async () => {
  const f = await fixture()
  const error = new Error('Child persistence failed')
  f.flush.mockResolvedValueOnce(true).mockRejectedValueOnce(error)
  await expect(f.service.edit(f.request)).rejects.toMatchObject({ code: 'conversationTools/incomplete', details: { phase: 'submission' }, cause: error })
  await expect(f.service.edit({ ...f.request, recoverySessionId: SessionId('child-1') })).resolves.toEqual({ sessionId: 'child-1' })
  expect(f.create).toHaveBeenCalledOnce()
  expect(f.agents.get(SessionId('child-1'))!.followup).toHaveBeenCalledOnce()
})

it('sorts equal-timestamp versions consistently after storage reloads', async () => {
  const f = await fixture()
  for (const id of ['z', 'a']) await f.edits.put(id, { sourceSessionId: f.source.id, childSessionId: SessionId(id), fingerprint: id, createdAt: 1 })
  expect(f.service.snapshot(f.source.id).versions.map(version => version.sessionId)).toEqual(['source', 'a', 'z'])
})
