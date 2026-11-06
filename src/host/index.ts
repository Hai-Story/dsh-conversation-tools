/** Optional message bookmarks and edit versions over the existing Session lifecycle. */
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Session } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { Remote, RemoteError, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import { conversationToolsDomain, type EditRecord } from './storage.ts'
import { planMessageEdit } from './edit-plan.ts'
import type { ConversationToolsSnapshot, EditMessageRequest, EditMessageResult, StarTurnRequest } from '../types.ts'

export type * from '../types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { conversationTools: ConversationTools }
}

/** Durable annotations and idempotent editing submissions. */
export default class ConversationTools extends TypertRemoteService {
  static inject = ['storageDomain', 'sessionController', 'sessionQuery', 'sessions', 'workingDirectory', 'remoteAccess', 'workspaceRegistry', 'permissionPresets']
  private domain!: Domain<typeof conversationToolsDomain>
  private readonly pending = new Map<string, { fingerprint: string; operation: Promise<EditMessageResult> }>()
  private readonly unlinked = new Map<string, EditRecord>()
  private closing = false
  private annotationTail: Promise<unknown> = Promise.resolve()

  /** @param ctx - Host plugin context. */
  constructor(ctx: Context) { super(ctx, 'conversationTools') }

  protected async [Service.init](): Promise<void> {
    this.domain = await this.ctx.storageDomain.open(conversationToolsDomain)
    this.ctx.effect(() => async () => {
      this.closing = true
      await Promise.allSettled([this.annotationTail, ...[...this.pending.values()].map(value => value.operation)])
      await this.domain.close()
    })
  }

  /**
   * Read bookmarks and version identities without loading model history.
   * @param sessionId - viewed Session.
   * @returns its bookmarks and accessible retained versions.
   */
  @Remote
  snapshot(sessionId: SessionId): ConversationToolsSnapshot {
    const edits = [...this.domain.table('edits').entries()].map(([, entry]) => entry)
    const family = new Set<SessionId>([sessionId])
    let changed = true
    while (changed) {
      changed = false
      for (const edit of edits) {
        if (!family.has(edit.sourceSessionId) && !family.has(edit.childSessionId)) continue
        for (const id of [edit.sourceSessionId, edit.childSessionId]) {
          if (!family.has(id)) { family.add(id); changed = true }
        }
      }
    }
    return {
      starredTurns: this.domain.table('stars').get(sessionId)?.turns ?? [],
      versions: [...family].filter(id => this.ctx.remoteAccess.allows({ kind: 'session', id }))
        .map(id => ({ sessionId: id, createdAt: edits.find(edit => edit.childSessionId === id)?.createdAt ?? 0 }))
        .sort((a, b) => a.createdAt - b.createdAt || a.sessionId.localeCompare(b.sessionId)),
    }
  }

  /**
   * Save an explicit bookmark state without changing conversation context.
   * @param request - desired bookmark state.
   * @returns annotations after durable storage.
   */
  @Remote
  star(request: StarTurnRequest): Promise<ConversationToolsSnapshot> {
    const operation = this.annotationTail.then(() => this.writeStar(request))
    this.annotationTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async writeStar(request: StarTurnRequest): Promise<ConversationToolsSnapshot> {
    if (this.closing) throw new Error('Conversation tools are unloading')
    using observation = await this.ctx.sessionQuery.observeSession(request.sessionId)
    if (!observation.events.some(event => event.type === 'turn/start' && event.data.turn === request.turn)) {
      throw new RemoteError('conversationTools/rejected', 'Turn does not exist', { reason: 'missing-message' })
    }
    const table = this.domain.table('stars')
    // update runs inside the domain's serialized write chain; concurrent turns are retained.
    if (table.get(request.sessionId) === undefined) await table.put(request.sessionId, { turns: [] })
    await table.update(request.sessionId, record => ({ turns: [...new Set(request.starred
      ? [...record.turns, request.turn] : record.turns.filter(turn => turn !== request.turn))].sort((a, b) => a - b) }))
    return this.snapshot(request.sessionId)
  }

  /**
   * Preserve the original Session and submit one replacement message to an exact-prefix version.
   * @param request - durable target and retry identity.
   * @returns the new Session, or an explicit recoverable child identity on partial failure.
   */
  @Remote
  edit(request: EditMessageRequest): Promise<EditMessageResult> {
    if (this.closing) return Promise.reject(new Error('Conversation tools are unloading'))
    if (request.text.trim() === '') return Promise.reject(new RemoteError('conversationTools/rejected', 'Message is empty', { reason: 'empty' }))
    const fingerprint = createHash('sha256').update(JSON.stringify([request.sessionId, request.messageId, request.text])).digest('hex')
    const current = this.domain.table('edits').get(request.requestId) ?? this.unlinked.get(request.requestId)
    if (current !== undefined && current.fingerprint !== fingerprint) {
      return Promise.reject(new RemoteError('conversationTools/rejected', 'Retry content changed', { reason: 'request-conflict' }))
    }
    if (request.recoverySessionId !== undefined && current?.childSessionId !== request.recoverySessionId) {
      return Promise.reject(new RemoteError('conversationTools/rejected', 'Saved version cannot be linked automatically; the draft is preserved', { reason: 'recovery-unavailable' }))
    }
    const pending = this.pending.get(request.requestId)
    if (pending !== undefined) return pending.fingerprint === fingerprint ? pending.operation
      : Promise.reject(new RemoteError('conversationTools/rejected', 'Retry content changed', { reason: 'request-conflict' }))
    const operation = this.performEdit(request, fingerprint).catch((error: unknown) => {
      this.ctx.logger.warn('conversation-tools: edit failed', { sessionId: request.sessionId, requestId: request.requestId }, error)
      throw error
    }).finally(() => { this.pending.delete(request.requestId) })
    this.pending.set(request.requestId, { fingerprint, operation })
    return operation
  }

  private createVersion(source: Agent, beforeSeq: number): Promise<EditMessageResult> {
    if (beforeSeq > 0) return this.ctx.sessionController.fork({ sessionId: source.id, atSeq: beforeSeq - 1 })
    const workspace = this.ctx.workspaceRegistry.list().find(entry => entry.sessionIds.includes(source.id))
    return this.ctx.sessionController.create({
      ...(workspace === undefined ? { cwd: source.session.header.cwd ?? this.ctx.workingDirectory.get(source.session) } : { workspaceId: workspace.id }),
      ...(source.session.header.agentPreset === undefined ? {} : { agentPreset: source.session.header.agentPreset }),
    })
  }

  /** Missing listeners are an unsupported persistence capability, not a failed disk write. */
  private async checkpoint(session: Session): Promise<void> {
    if (!await this.ctx.sessions.flush(session)) {
      throw new RemoteError('conversationTools/rejected', 'Durable session storage is required for retained edit versions', { reason: 'persistence-unavailable' })
    }
  }

  /** Catch only synchronous acquisition failure; errors inside the task keep their own classification. */
  private maintain<T>(agent: Agent, task: () => Promise<T>): Promise<T> {
    try { return agent.runMaintenance(task) } catch (error) {
      throw new RemoteError('conversationTools/rejected', 'This conversation is busy; retry after the current operation finishes', { reason: 'busy' }, { cause: error })
    }
  }

  private async performEdit(request: EditMessageRequest, fingerprint: string): Promise<EditMessageResult> {
    const resolved = await this.ctx.sessionController.resolveAgent(request.sessionId)
    if ('error' in resolved) throw resolved.error
    const source = resolved.agent
    const applyEdit = async (): Promise<EditMessageResult> => {
      using observation = await this.ctx.sessionQuery.observeSession(request.sessionId)
      const plan = planMessageEdit(observation.events, request.messageId, request.text)
      if (plan === undefined) throw new RemoteError('conversationTools/rejected', 'Human message does not exist', { reason: 'missing-message' })
      const stored = this.domain.table('edits').get(request.requestId)
      let record = stored ?? this.unlinked.get(request.requestId)
      if (record === undefined) {
        const child = await this.createVersion(source, plan.beforeSeq)
        record = { sourceSessionId: request.sessionId, childSessionId: child.sessionId, fingerprint, createdAt: Date.now() }
        this.unlinked.set(request.requestId, record)
      }
      if (stored === undefined) {
        try { await this.domain.table('edits').put(request.requestId, record) } catch (error) {
          throw new RemoteError('conversationTools/incomplete', 'Version created but its link could not be saved',
            { sessionId: record.childSessionId, phase: 'link' }, { cause: error })
        }
        this.unlinked.delete(request.requestId)
      }
      const childId = record.childSessionId
      try {
        if (this.domain.table('stars').get(childId) === undefined) {
          const turns = this.domain.table('stars').get(request.sessionId)?.turns.filter(turn => turn < plan.turn) ?? []
          await this.domain.table('stars').put(childId, { turns })
        }
        const target = await this.ctx.sessionController.resolveAgent(childId)
        if ('error' in target) throw target.error
        const child = target.agent
        using previous = await this.ctx.sessionQuery.observeSession(childId)
        const submitted = previous.events.some(event =>
          event.type === 'user/message' ? event.data.source.kind === 'user' && 'rpcId' in event.data.source && event.data.source.rpcId === request.requestId
            : event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === 'user' && 'rpcId' in message.source && message.source.rpcId === request.requestId))
        if (!submitted) {
          await this.maintain(child, async () => {
            child.inbox.clear()
            const selection = source.model.current()
            if (selection !== undefined) child.model.select(selection)
            const permission = this.ctx.permissionPresets.current(source.session)
            if (permission !== 'custom') this.ctx.permissionPresets.set(child.session, permission)
            else {
              const sandbox = observation.events.findLast(event => event.type === 'sandbox/mode')
              const approval = observation.events.findLast(event => event.type === 'approval/policy')
              if (sandbox?.type === 'sandbox/mode') setSandboxMode(child.session, sandbox.data.mode)
              if (approval?.type === 'approval/policy') setApprovalPolicy(child.session, approval.data.policy)
            }
            await this.ctx.workingDirectory.set(child, this.ctx.workingDirectory.get(source.session))
            const principal = principalOf(this.ctx.invocation)
            child.followup(createUserMessage({ content: plan.content, source: {
              kind: 'user', rpcId: request.requestId, ...(principal === undefined ? {} : { principal }),
            } }))
            await this.checkpoint(child.session)
          })
        }
        await this.checkpoint(child.session)
        return { sessionId: childId }
      } catch (error) {
        throw new RemoteError('conversationTools/incomplete', 'Version preserved; retry to continue',
          { sessionId: childId, phase: 'submission' }, { cause: error })
      }
    }
    // A retry resumes the already-created version without interrupting newer source work.
    await this.checkpoint(source.session)
    if (this.domain.table('edits').get(request.requestId) !== undefined) return applyEdit()
    if (this.unlinked.has(request.requestId)) return this.maintain(source, applyEdit)
    if (source.status !== 'idle') {
      // Invalid targets must not cancel an unrelated active task.
      using observation = await this.ctx.sessionQuery.observeSession(request.sessionId)
      if (planMessageEdit(observation.events, request.messageId, request.text) === undefined) {
        throw new RemoteError('conversationTools/rejected', 'Human message does not exist', { reason: 'missing-message' })
      }
      this.ctx.sessionController.cancel({ sessionId: request.sessionId })
      await source.whenIdle()
      await this.checkpoint(source.session)
    }
    return this.maintain(source, applyEdit)
  }
}
