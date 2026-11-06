import { expect, it, vi } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ToolsController } from '../src/client/controller.ts'
import type { RecoveryStore, RecoveryTicket } from '../src/client/recovery.ts'

function fixture(recovery?: RecoveryStore) {
  const snapshot = vi.fn(async () => ({ ok: true as const, value: { starredTurns: [], versions: [] } }))
  const star = vi.fn(async () => ({ ok: true as const, value: { starredTurns: [1], versions: [] } }))
  const edit = vi.fn(async () => ({ ok: true as const, value: { sessionId: SessionId('child') } }))
  const report = vi.fn()
  const controller = new ToolsController({ snapshot, star, edit }, SessionId('source'), report, recovery)
  return { controller, snapshot, star, edit, report }
}

it('shares one initial load and reflects a durable star in all consumers', async () => {
  const f = fixture()
  await Promise.all([f.controller.ensure(), f.controller.ensure()])
  expect(f.snapshot).toHaveBeenCalledOnce()
  await f.controller.star(1)
  expect(f.star).toHaveBeenCalledWith({ sessionId: 'source', turn: 1, starred: true })
  expect(f.controller.state.getSnapshot().starredTurns).toEqual([1])
})

it('retries a failed star write with its original value, even after refreshing', async () => {
  const f = fixture()
  f.star.mockRejectedValueOnce(new Error('write failed'))
  await f.controller.star(1)
  expect(f.controller.state.getSnapshot().failedStars).toEqual([{ turn: 1, starred: true }])
  // The first write may have reached the host before its reply was lost.
  f.snapshot.mockResolvedValueOnce({ ok: true, value: { starredTurns: [1], versions: [] } })
  await f.controller.refresh()
  expect(f.controller.state.getSnapshot().failedStars).toEqual([{ turn: 1, starred: true }])
  await f.controller.retry()
  expect(f.star.mock.calls[0]).toEqual(f.star.mock.calls[1])
  expect(f.controller.state.getSnapshot().starredTurns).toEqual([1])
  expect(f.controller.state.getSnapshot().failedStars).toEqual([])
})

it('preserves failed star writes across a failed load and unrelated navigation errors', async () => {
  const f = fixture()
  f.star.mockRejectedValueOnce(new Error('write failed'))
  await f.controller.star(1)
  f.snapshot.mockRejectedValueOnce(new Error('load failed'))
  await f.controller.refresh()
  f.controller.failOpen(SessionId('other'), new Error('open failed'))
  expect(f.controller.state.getSnapshot()).toMatchObject({ loadFailed: true,
    failedStars: [{ turn: 1, starred: true }], error: { kind: 'open', sessionId: 'other' } })
  await f.controller.refresh()
  f.controller.dismissError()
  expect(f.controller.state.getSnapshot().failedStars).toEqual([{ turn: 1, starred: true }])
  await f.controller.retry()
  expect(f.star).toHaveBeenCalledTimes(2)
  expect(f.star.mock.calls[0]).toEqual(f.star.mock.calls[1])
  expect(f.controller.state.getSnapshot()).toMatchObject({ loadFailed: false, failedStars: [], error: null })
})

it('retains both failed turns and clears only the successful retry', async () => {
  const f = fixture()
  f.star.mockRejectedValueOnce(new Error('turn one failed')).mockRejectedValueOnce(new Error('turn two failed'))
  await f.controller.star(1)
  await f.controller.star(2)
  expect(f.controller.state.getSnapshot().failedStars).toEqual([{ turn: 1, starred: true }, { turn: 2, starred: true }])
  f.star.mockResolvedValueOnce({ ok: true, value: { starredTurns: [1], versions: [] } }).mockRejectedValueOnce(new Error('still unavailable'))
  await f.controller.retry()
  expect(f.controller.state.getSnapshot().failedStars).toEqual([{ turn: 2, starred: true }])
})

it('ignores a stale refresh that started while a star write was pending', async () => {
  const f = fixture()
  await f.controller.ensure()
  const write = Promise.withResolvers<{ ok: true; value: { starredTurns: number[]; versions: [] } }>()
  const read = Promise.withResolvers<{ ok: true; value: { starredTurns: number[]; versions: [] } }>()
  f.star.mockReturnValueOnce(write.promise)
  f.snapshot.mockReturnValueOnce(read.promise)
  const saving = f.controller.star(1)
  await vi.waitFor(() => expect(f.star).toHaveBeenCalledOnce())
  const refreshing = f.controller.refresh()
  write.resolve({ ok: true, value: { starredTurns: [1], versions: [] } })
  await saving
  read.resolve({ ok: true, value: { starredTurns: [], versions: [] } })
  await refreshing
  expect(f.controller.state.getSnapshot().starredTurns).toEqual([1])
})

it.each(['busy', 'persistence-unavailable'] as const)('classifies %s without losing the edit text', async reason => {
  const f = fixture()
  f.edit.mockRejectedValueOnce(new RemoteError('conversationTools/rejected', 'Unavailable', { reason }))
  f.controller.begin(MessageId('message'), 'replacement')
  await f.controller.submit('replacement')
  expect(f.controller.state.getSnapshot().editing).toMatchObject({ text: 'replacement', pending: false,
    failed: true, failure: reason === 'busy' ? 'busy' : 'persistence' })
})

it('restores a partial edit after remount and retries the same child instead of creating another', async () => {
  let ticket: RecoveryTicket | undefined
  const recovery: RecoveryStore = { read: () => ticket, write: value => { ticket = value } }
  const f = fixture(recovery)
  f.edit.mockRejectedValueOnce(new RemoteError('conversationTools/incomplete', 'Link failed', { sessionId: SessionId('child'), phase: 'link' }))
  const previous = { text: 'unsent original draft', references: [] }
  f.controller.begin(MessageId('message'), 'replacement', previous)
  await f.controller.submit('replacement')
  expect(ticket?.previous).toEqual(previous)
  expect(ticket?.draft).toMatchObject({ text: 'replacement', recoverableSessionId: 'child' })
  f.controller.dispose()
  const resumed = fixture(recovery)
  const draft = resumed.controller.state.getSnapshot().editing!
  await resumed.controller.submit('changed after failure')
  expect(resumed.edit).not.toHaveBeenCalled()
  await resumed.controller.submit('replacement')
  expect(resumed.edit).toHaveBeenCalledWith({ sessionId: 'source', messageId: 'message', requestId: draft.requestId,
    text: 'replacement', recoverySessionId: 'child' })
  resumed.controller.complete()
  expect(ticket).toBeUndefined()
})

it('keeps a recovery ticket visible if reopening its composer fails', async () => {
  const f = fixture()
  f.edit.mockRejectedValueOnce(new RemoteError('conversationTools/incomplete', 'Link failed', { sessionId: SessionId('child'), phase: 'link' }))
  f.controller.begin(MessageId('message'), 'replacement')
  await f.controller.submit('replacement')
  f.controller.complete(false)
  expect(f.controller.recoveryTicket()?.draft.text).toBe('replacement')
})

it('saves a late partial failure after disposal without publishing to the released session', async () => {
  let ticket: RecoveryTicket | undefined
  const f = fixture({ read: () => ticket, write: value => { ticket = value } })
  const pending = Promise.withResolvers<never>()
  f.edit.mockReturnValueOnce(pending.promise)
  f.controller.begin(MessageId('message'), 'replacement', { text: 'original draft', references: [] })
  const submitted = f.controller.submit('replacement')
  f.controller.complete(false)
  f.controller.dispose()
  pending.reject(new RemoteError('conversationTools/incomplete', 'Link failed', { sessionId: SessionId('child'), phase: 'link' }))
  await submitted
  expect(f.controller.state.getSnapshot().editing).toBeNull()
  expect(ticket?.draft).toMatchObject({ text: 'replacement', recoverableSessionId: 'child', pending: false })
  expect(ticket?.previous?.text).toBe('original draft')
})

it('retains the draft and request identity after failure, then returns the same version on retry', async () => {
  const f = fixture()
  f.edit.mockRejectedValueOnce(new Error('connection lost'))
  f.controller.begin(MessageId('first-message'), 'original')
  f.controller.change('replacement')
  await f.controller.submit('replacement')
  expect(f.controller.state.getSnapshot().editing).toMatchObject({ text: 'replacement', failed: true, pending: false })
  expect(f.controller.state.getSnapshot().editing?.failed).toBe(true)
  await f.controller.submit('replacement')
  expect(f.edit.mock.calls[0]).toEqual(f.edit.mock.calls[1])
  expect(f.controller.state.getSnapshot().editing?.pending).toBe(true)
  f.controller.complete()
  expect(f.controller.state.getSnapshot().editing).toBeNull()
})

it('typing stays local and duplicate submissions share one pending edit', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<{ ok: true; value: { sessionId: ReturnType<typeof SessionId> } }>()
  f.edit.mockReturnValueOnce(pending.promise)
  f.controller.begin(MessageId('first-message'), 'original')
  f.controller.change('replacement')
  expect(f.edit).not.toHaveBeenCalled()
  const first = f.controller.submit('replacement')
  await f.controller.submit('replacement')
  expect(f.edit).toHaveBeenCalledOnce()
  expect(f.controller.state.getSnapshot().editing?.pending).toBe(true)
  pending.resolve({ ok: true, value: { sessionId: SessionId('child') } })
  expect(await first).toBe('child')
})
