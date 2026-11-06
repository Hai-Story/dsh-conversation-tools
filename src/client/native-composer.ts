/** Reuse the resident DSH composer through its scoped command-claim API. */
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandClaim, DraftAttachmentId, SessionInput, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DraftInput, DraftSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolsController } from './controller.ts'

export const EDIT_COMMAND = 'conversation-edit'
export const EDIT_TOKEN = '/edit '

/** The pinned 0.2.2 composer exposes a semantic snapshot so references and quotes can be restored losslessly. */
export interface NativeEditInput extends Pick<SessionInput, 'state' | 'addAttachments' | 'removeAttachment' | 'focus' | 'notify'> {
  readonly draftSnapshot: DraftSnapshot
  setDraft(draft: DraftInput): void
}

export interface ComposerPort {
  readonly input: NativeEditInput
  claim(claim: CommandClaim): boolean
  onDispose(cleanup: () => void): () => void
}

interface SavedComposer {
  readonly port: ComposerPort
  readonly draft: DraftSnapshot
  readonly attachments: readonly DraftAttachmentId[]
  unsubscribe: () => void
  unbind: () => void
  child?: SessionId
  changing: boolean
  scheduled: boolean
}

/** The native editor owns typing, keyboard behavior, Send, and the permission/model controls. */
export class NativeComposerEdit {
  private saved: SavedComposer | undefined
  private disposed = false

  constructor(private readonly controller: ToolsController, private readonly resolve: () => ComposerPort,
    private readonly open: (id: SessionId) => Promise<void>, private readonly failureText: () => string) {}

  begin = (messageId: MessageId, text: string): void => {
    if (this.disposed || this.controller.state.getSnapshot().editing?.pending) return
    const port = this.resolve()
    const state = port.input.state.getSnapshot()
    if (state.phase !== 'plain' && state.phase !== 'claimed') {
      port.input.notify('error', this.failureText())
      return
    }
    if (this.saved !== undefined) this.restore()
    const saved: SavedComposer = { port, draft: port.input.draftSnapshot,
      attachments: [...port.input.state.getSnapshot().attachmentIds], unsubscribe: () => {}, unbind: () => {}, changing: true, scheduled: false }
    this.saved = saved
    this.controller.begin(messageId, text)
    for (const id of saved.attachments) port.input.removeAttachment(id)
    port.input.setDraft(text)
    if (!this.claim(saved)) { this.restore(); port.input.notify('error', this.failureText()); return }
    saved.changing = false
    saved.unsubscribe = port.input.state.subscribe(() => this.changed(saved))
    saved.unbind = port.onDispose(() => this.restore())
    port.input.focus()
  }

  cancel = (): void => {
    if (this.controller.state.getSnapshot().editing?.pending) return
    this.restore()
  }

  dispose(): void { this.disposed = true; this.restore() }

  private claim(saved: SavedComposer): boolean {
    return saved.port.claim({
      name: EDIT_COMMAND, token: EDIT_TOKEN, attachments: false,
      submit: async (text): Promise<SubmitOutcome> => {
        if (this.saved !== saved || this.disposed) return { kind: 'error', text: this.failureText() }
        const child = await this.controller.submit(text)
        if (this.saved !== saved || this.disposed) return { kind: 'error', text: this.failureText() }
        if (child === undefined) return { kind: 'error', text: this.failureText() }
        saved.child = child
        return { kind: 'success' }
      },
    })
  }

  private changed(saved: SavedComposer): void {
    if (this.saved !== saved || saved.changing || saved.scheduled) return
    const state = saved.port.input.state.getSnapshot()
    if (state.phase !== 'plain' && state.phase !== 'claimed') return
    if (saved.child === undefined && state.claim?.name === EDIT_COMMAND) {
      this.controller.change(state.draft.startsWith(EDIT_TOKEN) ? state.draft.slice(EDIT_TOKEN.length) : state.draft)
      return
    }
    saved.scheduled = true
    // Let the native submit machine clear its accepted command before restoring the prior draft.
    queueMicrotask(() => {
      saved.scheduled = false
      if (this.saved !== saved || this.disposed) return
      if (saved.child !== undefined) {
        const child = saved.child
        this.restore()
        void this.controller.refresh().then(() => this.open(child)).catch(() => saved.port.input.notify('error', this.failureText()))
        return
      }
      const current = saved.port.input.state.getSnapshot()
      if (current.phase !== 'plain' && current.phase !== 'claimed') return
      if (current.claim?.name === EDIT_COMMAND) return
      // Select-all/paste may remove the command chip; the edit still owns this draft until Cancel.
      saved.changing = true
      const { command: _command, ...draft } = saved.port.input.draftSnapshot
      saved.port.input.setDraft(draft)
      this.controller.change(draft.text)
      if (!this.claim(saved)) { this.restore(); saved.port.input.notify('error', this.failureText()); return }
      saved.changing = false
    })
  }

  private restore(): void {
    const saved = this.saved
    if (saved === undefined) return
    this.saved = undefined
    saved.unsubscribe()
    saved.unbind()
    const added = saved.port.input.state.getSnapshot().attachmentIds
    saved.port.input.setDraft(saved.draft)
    saved.port.input.addAttachments(saved.attachments.filter(id => !added.includes(id)))
    this.controller.complete()
  }
}
