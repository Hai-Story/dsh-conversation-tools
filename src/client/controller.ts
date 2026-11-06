/** One observable controller per Session for annotations and inline editing drafts. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { remoteErrorOf, type TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../protocol/remote.js'
import type { ConversationToolsSnapshot } from '../types.ts'

/** Editing draft remains intact when a request fails. */
export interface EditingDraft {
  readonly messageId: MessageId
  readonly text: string
  readonly requestId: SessionRequestId
  readonly pending: boolean
  readonly failed: boolean
  readonly recoverableSessionId?: SessionId
}
/** Session-local UI state; committed annotations always come from the Host. */
export interface ToolsView extends ConversationToolsSnapshot {
  readonly loaded: boolean
  readonly failed: boolean
  readonly busyTurns: readonly number[]
  readonly editing: EditingDraft | null
}

/** Shared Session state published through the framework's injected hooks. */
export class ToolsController {
  /** Shared committed annotations and unsubmitted editing draft. */
  readonly state = createSnapshotStore<ToolsView>({
    starredTurns: [], versions: [], loaded: false, failed: false, busyTurns: [], editing: null,
  })
  private loading: Promise<void> | undefined
  private disposed = false
  private generation = 0

  /** @param remote - generated Remote namespace. @param sessionId - owner. */
  constructor(private readonly remote: TypertClientRemote['conversationTools'], readonly sessionId: SessionId) {}

  /** Load once for all mounted message actions. @returns completion of the shared read. */
  ensure = (): Promise<void> => this.state.getSnapshot().loaded ? Promise.resolve() : this.refresh()

  /** Reconcile Host state after reconnect, focus, or a version change. @returns read completion. */
  refresh = (): Promise<void> => {
    if (this.loading !== undefined) return this.loading
    const generation = this.generation
    this.loading = this.remote.snapshot(this.sessionId).then((result) => {
      if (!this.isAlive() || generation !== this.generation) return
      this.update(result.ok ? { ...result.value, loaded: true, failed: false } : { failed: true })
    }).catch(() => { if (this.isAlive() && generation === this.generation) this.update({ failed: true }) })
      .finally(() => { this.loading = undefined })
    return this.loading
  }

  /** Toggle one loaded bookmark. @param turn - turn to toggle after the authoritative state is loaded. */
  star = async (turn: number): Promise<void> => {
    await this.ensure()
    const current = this.state.getSnapshot()
    if (!this.isAlive() || !current.loaded || current.busyTurns.includes(turn)) return
    this.generation++
    this.update({ busyTurns: [...current.busyTurns, turn], failed: false })
    try {
      const result = await this.remote.star({ sessionId: this.sessionId, turn, starred: !current.starredTurns.includes(turn) })
      if (this.isAlive()) {
        if (!result.ok) this.update({ failed: true })
        else {
          const otherTurns = this.state.getSnapshot().starredTurns.filter(value => value !== turn)
          const starredTurns = result.value.starredTurns.includes(turn) ? [...otherTurns, turn].sort((a, b) => a - b) : otherTurns
          this.update({ starredTurns, versions: result.value.versions, failed: false })
        }
      }
    } catch (_error) { if (this.isAlive()) this.update({ failed: true }) }
    finally { if (this.isAlive()) this.update({ busyTurns: this.state.getSnapshot().busyTurns.filter(value => value !== turn) }) }
  }

  /** Open a message-local draft. @param messageId - original human input. @param text - original text. */
  begin = (messageId: MessageId, text: string): void => {
    if (this.state.getSnapshot().editing?.pending) return
    this.update({ editing: { messageId, text, requestId: randomUUID() as SessionRequestId, pending: false, failed: false } })
  }
  /** Replace the local draft text. @param text - edited draft; changing it creates a distinct request identity. */
  change = (text: string): void => {
    const draft = this.state.getSnapshot().editing
    if (draft === null || draft.pending || draft.text === text) return
    this.update({ editing: { ...draft, text, requestId: randomUUID() as SessionRequestId, failed: false } })
  }
  /** Submit or retry the unchanged draft; failure preserves both its text and request id. */
  submit = async (text: string): Promise<SessionId | undefined> => {
    this.change(text)
    const draft = this.state.getSnapshot().editing
    if (draft === null || draft.pending || draft.recoverableSessionId !== undefined || draft.text.trim() === '') return
    this.update({ editing: { ...draft, pending: true, failed: false } })
    try {
      const result = await this.remote.edit({
        sessionId: this.sessionId, messageId: draft.messageId, text: draft.text, requestId: draft.requestId,
      })
      if (!result.ok) throw result.error
      if (!this.isAlive()) return
      return result.value.sessionId
    } catch (error) {
      const failure = remoteErrorOf(error)
      const recovery = failure?.code === 'conversationTools/incomplete' && failure.details.phase === 'link'
        ? failure.details.sessionId : undefined
      if (this.isAlive()) this.update({ editing: { ...draft, pending: false, failed: true,
        ...(recovery === undefined ? {} : { recoverableSessionId: recovery }) } })
    }
  }

  /** Finish a settled or cancelled native-composer edit. */
  complete = (): void => { this.update({ editing: null }) }

  /** Prevent late responses from publishing after plugin disposal. */
  dispose(): void { this.disposed = true }
  private isAlive(): boolean { return !this.disposed }
  private update(patch: Partial<ToolsView>): void { this.state.set({ ...this.state.getSnapshot(), ...patch }) }
}
