import { expect, it, vi } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ToolsController } from '../src/client/controller.ts'

function fixture() {
  const snapshot = vi.fn(async () => ({ ok: true as const, value: { starredTurns: [], versions: [] } }))
  const star = vi.fn(async () => ({ ok: true as const, value: { starredTurns: [1], versions: [] } }))
  const edit = vi.fn(async () => ({ ok: true as const, value: { sessionId: SessionId('child') } }))
  const open = vi.fn(async () => {})
  const controller = new ToolsController({ snapshot, star, edit }, SessionId('source'), open)
  return { controller, snapshot, star, edit, open }
}

it('shares one initial load and reflects a durable star in all consumers', async () => {
  const f = fixture()
  await Promise.all([f.controller.ensure(), f.controller.ensure()])
  expect(f.snapshot).toHaveBeenCalledOnce()
  await f.controller.star(1)
  expect(f.star).toHaveBeenCalledWith({ sessionId: 'source', turn: 1, starred: true })
  expect(f.controller.state.getSnapshot().starredTurns).toEqual([1])
})

it('retains the draft and request identity after failure, then opens the edited version on retry', async () => {
  const f = fixture()
  f.edit.mockRejectedValueOnce(new Error('connection lost'))
  f.controller.begin(MessageId('first-message'), 'original')
  f.controller.change('replacement')
  await f.controller.save()
  expect(f.controller.state.getSnapshot().editing).toMatchObject({ text: 'replacement', failed: true, pending: false })
  expect(f.open).not.toHaveBeenCalled()
  await f.controller.save()
  expect(f.edit.mock.calls[0]).toEqual(f.edit.mock.calls[1])
  expect(f.open).toHaveBeenCalledWith('child')
  expect(f.controller.state.getSnapshot().editing).toBeNull()
})

it('cancelling an edit never submits a model request', () => {
  const f = fixture()
  f.controller.begin(MessageId('first-message'), 'original')
  f.controller.cancel()
  expect(f.edit).not.toHaveBeenCalled()
  expect(f.controller.state.getSnapshot().editing).toBeNull()
})
