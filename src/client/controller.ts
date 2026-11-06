/** One observable controller per Session for annotations and inline editing drafts. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { remoteErrorOf, type TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../protocol/remote.js'
import type { DraftSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { recoveryStore, type RecoveryStore, type RecoveryTicket } from './recovery.ts'
import type { ConversationToolsSnapshot } from '../types.ts'

/** Editing draft remains intact when a request fails. */
export interface EditingDraft {
  readonly messageId: MessageId
  readonly text: string
  readonly requestId: SessionRequestId
  readonly pending: boolean
  readonly failed: boolean
  readonly failure?: 'submit' | 'busy' | 'persistence' | 'partial' | 'recovery-unavailable'
  readonly recoverableSessionId?: SessionId
}
/** Failed operations retain their exact retry intent. */
export type ToolsError = { kind: 'edit-start' } | { kind: 'open'; sessionId: SessionId }
export interface FailedStar { readonly turn: number; readonly starred: boolean }

/** Session-local UI state; committed annotations always come from the Host. */
export interface ToolsView extends ConversationToolsSnapshot {
  readonly available: boolean
  readonly loaded: boolean
  readonly loadFailed: boolean
  readonly failedStars: readonly FailedStar[]
  readonly error: ToolsError | null
  readonly uiIssues: readonly string[]
  readonly busyTurns: readonly number[]
  readonly editing: EditingDraft | null
}

export const initialToolsView: ToolsView = {
  starredTurns: [], versions: [], available: true, loaded: false, loadFailed: false, failedStars: [],
  error: null, uiIssues: [], busyTurns: [], editing: null,
}

/** Shared Session state published through the framework's injected hooks. */
export class ToolsController {
  /** Shared committed annotations and unsubmitted editing draft. */
  readonly state = createSnapshotStore<ToolsView>({ ...initialToolsView })
  private loading: Promise<void> | undefined
  private disposed = false
  private generation = 0
  private previousDraft: DraftSnapshot | undefined
  private readonly recovery: RecoveryStore

  /** @param remote - generated Remote namespace. @param sessionId - owner. */
  constructor(private readonly remote: TypertClientRemote['conversationTools'], readonly sessionId: SessionId,
    private readonly report: (operation: string, error: unknown) => void = (operation, error) => console.warn(`[dsh-conversation-tools] ${operation}`, error),
    recovery?: RecoveryStore) {
    this.recovery = recovery ?? recoveryStore(sessionId, error => this.report('recovery storage', error))
    const saved = this.recovery.read()
    if (saved !== undefined) { this.previousDraft = saved.previous; this.update({ editing: saved.draft }) }
  }

  /** Load once for all mounted message actions. @returns completion of the shared read. */
  ensure = (): Promise<void> => this.disposed || this.state.getSnapshot().loaded ? Promise.resolve() : this.refresh()

  /** Reconcile Host state after reconnect, focus, or a version change. @returns read completion. */
  refresh = (): Promise<void> => {
    if (this.disposed) return Promise.resolve()
    if (this.loading !== undefined) return this.loading
    const generation = this.generation
    this.loading = this.remote.snapshot(this.sessionId).then((result) => {
      if (!this.isAlive() || generation !== this.generation) return
      if (result.ok) this.update({ ...result.value, loaded: true, loadFailed: false })
      else { this.report('load', result.error); this.update({ loadFailed: true }) }
    }).catch(error => { if (this.isAlive() && generation === this.generation) { this.report('load', error); this.update({ loadFailed: true }) } })
      .finally(() => { this.loading = undefined })
    return this.loading
  }

  /** Read before toggling; retries send the same explicit value even after an uncertain response. */
  star = async (turn: number): Promise<void> => {
    await this.ensure()
    const current = this.state.getSnapshot()
    if (!this.isAlive() || !current.loaded) return
    await this.writeStar(turn, !current.starredTurns.includes(turn))
  }

  retry = async (): Promise<void> => {
    await Promise.all(this.state.getSnapshot().failedStars.map(({ turn, starred }) => this.writeStar(turn, starred)))
  }

  private async writeStar(turn: number, starred: boolean): Promise<void> {
    const current = this.state.getSnapshot()
    if (!this.isAlive() || current.busyTurns.includes(turn)) return
    this.generation++
    this.update({ busyTurns: [...current.busyTurns, turn] })
    try {
      const result = await this.remote.star({ sessionId: this.sessionId, turn, starred })
      if (!result.ok) throw result.error
      if (this.isAlive()) {
        this.generation++
        const otherTurns = this.state.getSnapshot().starredTurns.filter(value => value !== turn)
        const starredTurns = result.value.starredTurns.includes(turn) ? [...otherTurns, turn].sort((a, b) => a - b) : otherTurns
        this.update({ starredTurns, versions: result.value.versions,
          failedStars: this.state.getSnapshot().failedStars.filter(failure => failure.turn !== turn) })
      }
    } catch (error) {
      if (this.isAlive()) {
        this.report('star', error)
        this.update({ failedStars: [...this.state.getSnapshot().failedStars.filter(failure => failure.turn !== turn), { turn, starred }] })
      }
    } finally { if (this.isAlive()) this.update({ busyTurns: this.state.getSnapshot().busyTurns.filter(value => value !== turn) }) }
  }

  failStart = (error: unknown): void => { this.report('begin edit', error); this.update({ error: { kind: 'edit-start' } }) }
  failOpen = (sessionId: SessionId, error: unknown): void => { this.report('open version', error); this.update({ error: { kind: 'open', sessionId } }) }
  dismissError = (): void => { this.update({ error: null }) }
  diagnose = (uiIssues: readonly string[]): void => {
    if (JSON.stringify(uiIssues) !== JSON.stringify(this.state.getSnapshot().uiIssues)) this.update({ uiIssues })
  }
  recoveryTicket = (): RecoveryTicket | undefined => {
    const draft = this.state.getSnapshot().editing
    return draft?.recoverableSessionId === undefined ? undefined : { draft, ...(this.previousDraft === undefined ? {} : { previous: this.previousDraft }) }
  }

  /** Open a message-local draft. @param messageId - original human input. @param text - original text. */
  begin = (messageId: MessageId, text: string, previous?: DraftSnapshot, recovery?: EditingDraft): void => {
    if (this.state.getSnapshot().editing?.pending) return
    this.previousDraft = previous
    if (recovery === undefined) this.recovery.write(undefined)
    this.update({ error: null, editing: recovery ?? { messageId, text, requestId: randomUUID() as SessionRequestId, pending: false, failed: false } })
  }
  /** Replace the local draft text. @param text - edited draft; changing it creates a distinct request identity. */
  change = (text: string): void => {
    const draft = this.state.getSnapshot().editing
    if (draft === null || draft.pending || draft.text === text || draft.recoverableSessionId !== undefined) return
    this.update({ editing: { ...draft, text, requestId: randomUUID() as SessionRequestId, failed: false } })
  }
  /** Submit or retry the unchanged draft; failure preserves both its text and request id. */
  submit = async (text: string): Promise<SessionId | undefined> => {
    this.change(text)
    const draft = this.state.getSnapshot().editing
    if (draft === null || draft.pending || draft.failure === 'recovery-unavailable' || draft.text.trim() === '') return
    if (draft.recoverableSessionId !== undefined && text !== draft.text) {
      this.update({ editing: { ...draft, failed: true, failure: 'partial' } })
      return
    }
    const previous = this.previousDraft
    this.update({ editing: { ...draft, pending: true, failed: false } })
    try {
      const result = await this.remote.edit({
        sessionId: this.sessionId, messageId: draft.messageId, text: draft.text, requestId: draft.requestId,
        ...(draft.recoverableSessionId === undefined ? {} : { recoverySessionId: draft.recoverableSessionId }),
      })
      if (!result.ok) throw result.error
      if (!this.isAlive()) return
      return result.value.sessionId
    } catch (error) {
      const failure = remoteErrorOf(error)
      const recovery = failure?.code === 'conversationTools/incomplete'
        ? failure.details.sessionId : draft.recoverableSessionId
      const reason = failure?.code === 'conversationTools/rejected' ? failure.details.reason : undefined
      const kind = reason === 'busy' ? 'busy' : reason === 'persistence-unavailable' ? 'persistence'
        : reason === 'recovery-unavailable' ? 'recovery-unavailable' : recovery === undefined ? 'submit' : 'partial'
      const failed: EditingDraft = { ...draft, pending: false, failed: true, failure: kind,
        ...(recovery === undefined ? {} : { recoverableSessionId: recovery }) }
      // Closing a session while its request settles must not lose a created child.
      if (recovery !== undefined) this.recovery.write({ draft: failed, ...(previous === undefined ? {} : { previous }) })
      if (this.isAlive()) { this.report('submit edit', error); this.update({ editing: failed }) }
    }
  }

  /** Finish a settled or cancelled native-composer edit. */
  complete = (discardRecovery = true): void => {
    if (discardRecovery) { this.recovery.write(undefined); this.previousDraft = undefined }
    this.update({ editing: discardRecovery ? null : this.recoveryTicket()?.draft ?? null })
  }

  /** Prevent late responses from publishing after plugin disposal. */
  dispose(): void { this.disposed = true }
  private isAlive(): boolean { return !this.disposed }
  private update(patch: Partial<ToolsView>): void {
    if (!this.disposed) this.state.set({ ...this.state.getSnapshot(), ...patch })
  }
}
