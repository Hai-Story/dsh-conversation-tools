import { expect, it, vi } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ToolsController } from '../src/client/controller.ts'

function fixture() {
  const snapshot = vi.fn(async () => ({ ok: true as const, value: { starredTurns: [], versions: [] } }))
  const star = vi.fn(async () => ({ ok: true as const, value: { starredTurns: [1], versions: [] } }))
  const edit = vi.fn(async () => ({ ok: true as const, value: { sessionId: SessionId('child') } }))
  const controller = new ToolsController({ snapshot, star, edit }, SessionId('source'))
  return { controller, snapshot, star, edit }
}

it('shares one initial load and reflects a durable star in all consumers', async () => {
  const f = fixture()
  await Promise.all([f.controller.ensure(), f.controller.ensure()])
  expect(f.snapshot).toHaveBeenCalledOnce()
  await f.controller.star(1)
  expect(f.star).toHaveBeenCalledWith({ sessionId: 'source', turn: 1, starred: true })
  expect(f.controller.state.getSnapshot().starredTurns).toEqual([1])
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
