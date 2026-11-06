import { expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandClaim, DraftAttachmentId, DraftInput, DraftSnapshot, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ToolsController } from '../src/client/controller.ts'
import { EDIT_COMMAND, EDIT_TOKEN, NativeComposerEdit, type NativeEditInput } from '../src/client/native-composer.ts'

function fixture() {
  const attachment = 'saved-file' as DraftAttachmentId
  const initial: DraftSnapshot = { text: 'Original draft', references: [], quotes: [{ offset: 0, length: 8, text: 'Original' }] }
  let snapshot = initial
  const state = createSnapshotStore<InputState>({ draft: initial.text, attachmentIds: [attachment], draftRev: 0, phase: 'plain', occurrences: [], queue: [] })
  const update = (patch: Partial<InputState>) => state.set({ ...state.getSnapshot(), ...patch })
  const input: NativeEditInput = {
    state, get draftSnapshot() { return snapshot },
    setDraft: (value: DraftInput) => { snapshot = typeof value === 'string' ? { text: value, references: [] } : value;
      const { claim: _claim, ...rest } = state.getSnapshot(); state.set({ ...rest, phase: 'plain', draft: snapshot.text, draftRev: rest.draftRev + 1 }) },
    focus: vi.fn(), notify: vi.fn(),
    addAttachments: ids => { update({ attachmentIds: [...state.getSnapshot().attachmentIds, ...ids] }); return true },
    removeAttachment: id => { update({ attachmentIds: state.getSnapshot().attachmentIds.filter(value => value !== id) }); return true },
  }
  let claimed: CommandClaim
  const claim = vi.fn((value: CommandClaim) => { claimed = value; update({ phase: 'claimed', draft: EDIT_TOKEN + snapshot.text,
    claim: { name: value.name, token: value.token } }); return true })
  const edit = vi.fn(async () => ({ ok: true as const, value: { sessionId: SessionId('child') } }))
  const report = vi.fn()
  const controller = new ToolsController({ edit, snapshot: async () => ({ ok: true, value: { starredTurns: [], versions: [] } }), star: vi.fn() }, SessionId('source'), report)
  const open = vi.fn(async () => {})
  const resolve = vi.fn(() => ({ input, claim, onDispose: () => () => {} }))
  const bridge = new NativeComposerEdit(controller, resolve, open, () => 'Failed')
  return { bridge, controller, edit, open, input, update, claim, resolve, report, initial, attachment, submit: (text: string) => claimed.submit(text, {} as never, []) }
}

it('keeps editing local and restores the full prior draft and attachments on cancellation', () => {
  const f = fixture()
  f.bridge.begin(MessageId('message'), 'Sent text')
  expect(f.claim).toHaveBeenCalledOnce()
  expect(f.input.state.getSnapshot().claim?.name).toBe(EDIT_COMMAND)
  expect(f.input.state.getSnapshot().attachmentIds).toEqual([])
  expect(f.edit).not.toHaveBeenCalled()
  vi.mocked(f.input.focus).mockClear()
  f.bridge.cancel()
  expect(f.input.draftSnapshot).toEqual(f.initial)
  expect(f.input.state.getSnapshot().attachmentIds).toEqual([f.attachment])
  expect(f.open).not.toHaveBeenCalled()
  expect(f.input.focus).toHaveBeenCalledOnce()
})

it('waits for native submission settlement before restoring the old draft and opening the new version', async () => {
  const f = fixture()
  f.bridge.begin(MessageId('message'), 'Sent text')
  f.update({ phase: 'submitting' })
  expect(await f.submit('Edited text')).toEqual({ kind: 'success' })
  expect(f.open).not.toHaveBeenCalled()
  f.input.setDraft('')
  await vi.waitFor(() => expect(f.open).toHaveBeenCalledExactlyOnceWith('child'))
  expect(f.input.draftSnapshot).toEqual(f.initial)
  expect(f.controller.state.getSnapshot().editing).toBeNull()
})

it('keeps the edit claim after select-all replaces the chip, and disposal restores the draft', async () => {
  const f = fixture()
  f.bridge.begin(MessageId('message'), 'Sent text')
  f.input.setDraft('Replacement')
  await vi.waitFor(() => expect(f.claim).toHaveBeenCalledTimes(2))
  expect(f.input.state.getSnapshot().claim?.name).toBe(EDIT_COMMAND)
  expect(f.edit).not.toHaveBeenCalled()
  f.bridge.dispose()
  expect(f.input.draftSnapshot).toEqual(f.initial)
})

it('does not overwrite a native draft whose submission is already in flight', () => {
  const f = fixture()
  f.update({ phase: 'sending' })
  f.bridge.begin(MessageId('message'), 'Sent text')
  expect(f.input.draftSnapshot).toEqual(f.initial)
  expect(f.claim).not.toHaveBeenCalled()
  expect(f.controller.state.getSnapshot().error).toEqual({ kind: 'edit-start' })
})

it('reports an unavailable composer without throwing or touching the prior draft', () => {
  const f = fixture()
  const error = new Error('Conversation is not retained')
  f.resolve.mockImplementationOnce(() => { throw error })
  expect(() => f.bridge.begin(MessageId('message'), 'Sent text')).not.toThrow()
  expect(f.controller.state.getSnapshot().error).toEqual({ kind: 'edit-start' })
  expect(f.report).toHaveBeenCalledWith('begin edit', error)
  expect(f.input.draftSnapshot).toEqual(f.initial)
  expect(f.input.state.getSnapshot().attachmentIds).toEqual([f.attachment])
})

it('restores the draft and attachments if claiming the native editor fails', () => {
  const f = fixture()
  f.claim.mockReturnValueOnce(false)
  f.bridge.begin(MessageId('message'), 'Sent text')
  expect(f.input.draftSnapshot).toEqual(f.initial)
  expect(f.input.state.getSnapshot().attachmentIds).toEqual([f.attachment])
  expect(f.controller.state.getSnapshot().error).toEqual({ kind: 'edit-start' })
  expect(f.controller.state.getSnapshot().editing).toBeNull()
})

it('does not steal focus on disposal and ignores late submission completion', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<{ ok: true; value: { sessionId: ReturnType<typeof SessionId> } }>()
  f.edit.mockReturnValueOnce(pending.promise)
  f.bridge.begin(MessageId('message'), 'Sent text')
  const submitted = f.submit('Edited text')
  vi.mocked(f.input.focus).mockClear()
  f.bridge.dispose()
  f.controller.dispose()
  pending.resolve({ ok: true, value: { sessionId: SessionId('child') } })
  await submitted
  expect(f.input.draftSnapshot).toEqual(f.initial)
  expect(f.input.focus).not.toHaveBeenCalled()
  expect(f.open).not.toHaveBeenCalled()
})

it('keeps the saved child available when opening its completed edit fails', async () => {
  const f = fixture()
  f.open.mockRejectedValueOnce(new Error('Navigation failed'))
  f.bridge.begin(MessageId('message'), 'Sent text')
  await f.submit('Edited text')
  f.input.setDraft('')
  await vi.waitFor(() => expect(f.controller.state.getSnapshot().error).toEqual({ kind: 'open', sessionId: 'child' }))
  expect(f.input.draftSnapshot).toEqual(f.initial)
  expect(f.edit).toHaveBeenCalledOnce()
})

it('switching the edited message keeps the original composer draft and saved attachments', () => {
  const f = fixture()
  f.bridge.begin(MessageId('one'), 'First message')
  f.bridge.begin(MessageId('two'), 'Second message')
  expect(f.input.state.getSnapshot().attachmentIds).toEqual([])
  f.bridge.cancel()
  expect(f.input.draftSnapshot).toEqual(f.initial)
  expect(f.input.state.getSnapshot().attachmentIds).toEqual([f.attachment])
})
