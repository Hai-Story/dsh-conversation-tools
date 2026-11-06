/** Optional controls in the existing message actions, inline body, and turn rail. */
import { useEffect } from 'react'
import { Button, IconEditOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolsView } from './controller.ts'
import type {} from './locales.ts'
import { EDIT_COMMAND } from './native-composer.ts'
import css from './Controls.module.css'

/** Session callbacks injected by the plugin; components never access services. */
export interface ToolsInjected {
  hooks: { tools: HostObservable<ToolsView> }
  ensure: () => Promise<void>
  refresh: () => Promise<void>
  retry: () => Promise<void>
  dismissError: () => void
  diagnose: (issues: readonly string[]) => void
  resume: () => void
  star: (turn: number) => Promise<void>
  begin: (messageId: MessageId, text: string) => void
  cancel: () => void
  open: (id: SessionId) => Promise<void>
}
export type Face = InjectFace<ToolsInjected> & PropsLocale<'conversationTools'>
export type UserProps = PropsRuntime<'conversation.session.header.utilities'> & Face & { messageId: MessageId; turn: number; text: string }
type AssistantProps = PropsRuntime<'conversation.chat.assistant-actions'> & Face

function StarButton({ turn, useTools, ensure, star, t }: Pick<UserProps, 'turn' | 'useTools' | 'ensure' | 'star' | 't'>) {
  const starred = useTools(state => state.starredTurns.includes(turn))
  const pending = useTools(state => state.busyTurns.includes(turn))
  const loaded = useTools(state => state.loaded)
  useEffect(() => { void ensure() }, [ensure])
  const label = t(starred ? 'unstar' : 'star')
  return <Tooltip portal label={label} side="bottom">
    <button type="button" className={css.action} aria-label={label} aria-pressed={starred}
      data-starred={starred || undefined} disabled={pending || !loaded} onClick={() => { void star(turn) }}>
      <span aria-hidden="true" className={css.star}>{starred ? '★' : '☆'}</span>
    </button>
  </Tooltip>
}

/** @param props - durable human-message target. @returns star and edit actions next to Copy. */
export function UserActions(props: UserProps) {
  const editing = props.useTools(state => state.editing?.pending === true)
  const canStar = props.useAccess('conversationTools/star')
  const canEdit = props.useAccess('conversationTools/edit')
  return <>
    {canStar && <StarButton {...props} />}
    {canEdit && <Tooltip portal label={props.t('edit')} side="bottom">
      <button type="button" className={css.action} aria-label={props.t('edit')} aria-disabled={editing}
        onClick={() => { if (!editing) props.begin(props.messageId, props.text) }}>
        <IconEditOutlineRegular />
      </button>
    </Tooltip>}
  </>
}

/** @param props - final assistant target. @returns the same exchange's star action. */
export function AssistantActions(props: AssistantProps) {
  const allowed = props.useAccess('conversationTools/star')
  const turn = props.useChat(snapshot => {
    for (const key of snapshot.order) {
      const node = snapshot.nodes.get(key) as ChatNode | undefined
      if (node?.kind === 'turn-tail' && node.data.closing?.finalNode.messageId === props.messageId) return node.data.turn
    }
    return undefined
  })
  return !allowed || turn === undefined ? null : <StarButton {...props} turn={turn} />
}

/** Compact edit-mode notice above the unchanged resident composer. */
export function EditComposerNotice({ useTools, useInput, cancel, resume, open, t }: PropsRuntime<'conversation.input.dock'> & Face) {
  const draft = useTools(state => state.editing)
  const active = useInput(input => input.claim?.name === EDIT_COMMAND)
  if (draft === null) return null
  const failureKey = draft.failure === 'busy' ? 'busy' : draft.failure === 'persistence' ? 'persistenceUnavailable'
    : draft.failure === 'partial' ? 'partial' : draft.failure === 'recovery-unavailable' ? 'recoveryUnavailable' : 'failed'
  return <div className={css.editNotice} data-conversation-tools-editing aria-busy={draft.pending}>
    <div className={css.editLabel}><IconEditOutlineRegular size={14} />
      <span>{t(draft.pending ? 'saving' : 'editing')}</span>
      {!draft.pending && <span className={css.editHint}>{t('submitHint')}</span>}
    </div>
    <Button size="sm" disabled={draft.pending} onClick={cancel}>{t('cancelEdit')}</Button>
    {draft.failed && <span role="alert" className={css.error}>{t(failureKey)}</span>}
    {!active && draft.recoverableSessionId !== undefined && <Button size="sm" onClick={resume}>{t('resumeEdit')}</Button>}
    {draft.recoverableSessionId !== undefined && <Button size="sm" onClick={() => {
      const id = draft.recoverableSessionId
      if (id !== undefined) void open(id)
    }}>{t('recovery')}</Button>}
  </div>
}

/** @param props - Session header seat. @returns a retained-version selector and recoverable load errors. */
export function VersionPicker({ sessionId, useTools, ensure, refresh, open, retry, dismissError, t }: PropsRuntime<'conversation.session.header.utilities'> & Face) {
  const versions = useTools(state => state.versions)
  const error = useTools(state => state.error)
  const uiIssues = useTools(state => state.uiIssues)
  useEffect(() => { void ensure() }, [ensure])
  return <div className={css.versions}>
    {versions.length > 1 && <select aria-label={t('versions')} value={sessionId}
      onFocus={() => { void refresh() }} onChange={(event) => {
        void open(SessionId(event.target.value))
      }}>
      {versions.map((version, index) => <option key={version.sessionId} value={version.sessionId}>
        {t('version', { number: index + 1 })}
      </option>)}
    </select>}
    {uiIssues.length > 0 && <span className={css.error} role="status">{t('uiUnsupported')}</span>}
    {error !== null && <span className={css.error} role="alert">
      {t(error.kind === 'star' ? 'starFailed' : error.kind === 'open' ? 'openFailed' : error.kind === 'edit-start' ? 'beginFailed' : 'loadFailed')}
      {error.kind !== 'edit-start' && <button type="button" onClick={() => { void retry() }}>{t('retry')}</button>}
      <button type="button" onClick={dismissError}>{t('dismiss')}</button>
    </span>}
  </div>
}
