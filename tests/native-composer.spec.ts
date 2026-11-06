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
  const controller = new ToolsController({ edit, snapshot: async () => ({ ok: true, value: { starredTurns: [], versions: [] } }), star: vi.fn() }, SessionId('source'))
  const open = vi.fn(async () => {})
  const bridge = new NativeComposerEdit(controller, () => ({ input, claim, onDispose: () => () => {} }), open, () => 'Failed')
  return { bridge, controller, edit, open, input, update, claim, initial, attachment, submit: (text: string) => claimed.submit(text, {} as never, []) }
}

it('keeps editing local and restores the full prior draft and attachments on cancellation', () => {
  const f = fixture()
  f.bridge.begin(MessageId('message'), 'Sent text')
  expect(f.claim).toHaveBeenCalledOnce()
  expect(f.input.state.getSnapshot().claim?.name).toBe(EDIT_COMMAND)
  expect(f.input.state.getSnapshot().attachmentIds).toEqual([])
  expect(f.edit).not.toHaveBeenCalled()
  f.bridge.cancel()
  expect(f.input.draftSnapshot).toEqual(f.initial)
  expect(f.input.state.getSnapshot().attachmentIds).toEqual([f.attachment])
  expect(f.open).not.toHaveBeenCalled()
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
  expect(f.input.notify).toHaveBeenCalledWith('error', 'Failed')
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
