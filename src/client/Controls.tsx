/** Optional controls in the existing message actions, inline body, and turn rail. */
import { useEffect, useState } from 'react'
import { Button, IconEditOutlineRegular, InlineEditor, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolsView } from './controller.ts'
import type {} from './locales.ts'
import css from './Controls.module.css'

/** Session callbacks injected by the plugin; components never access services. */
export interface ToolsInjected {
  hooks: { tools: HostObservable<ToolsView> }
  ensure: () => Promise<void>
  refresh: () => Promise<void>
  star: (turn: number) => Promise<void>
  begin: (messageId: MessageId, text: string) => void
  change: (text: string) => void
  cancel: () => void
  save: () => Promise<void>
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

/** @param props - message-local editor seat. @returns the active draft, or nothing. */
export function MessageEditor({ messageId, useTools, change, cancel, save, open, t }: UserProps) {
  const [recoveryFailed, setRecoveryFailed] = useState(false)
  const draft = useTools(state => state.editing?.messageId === messageId ? state.editing : null)
  if (draft === null) return null
  const disabled = draft.pending || draft.recoverableSessionId !== undefined || draft.text.trim() === ''
  return <div className={css.editor} aria-busy={draft.pending}>
    <fieldset disabled={draft.pending} className={css.fieldset}>
      <InlineEditor value={draft.text} label={t('edit')} onChange={change} onCancel={cancel}
        onSave={() => { if (!disabled) void save() }} />
      <p className={css.hint}>{t('retained')}</p>
      {draft.failed && <p className={css.error} role="alert">{t(draft.recoverableSessionId === undefined ? 'failed' : 'partial')}</p>}
      {draft.recoverableSessionId !== undefined && <Button onClick={() => {
        const id = draft.recoverableSessionId
        if (id !== undefined) { setRecoveryFailed(false); void open(id).catch(() => { setRecoveryFailed(true) }) }
      }}>{t('recovery')}</Button>}
      {recoveryFailed && <p role="alert" className={css.error}>{t('loadFailed')}</p>}
      <div className={css.buttons}>
        <Button onClick={cancel}>{t('cancel')}</Button>
        <Button variant="primary" disabled={disabled} onClick={() => { void save() }}>{t(draft.pending ? 'saving' : 'save')}</Button>
      </div>
    </fieldset>
  </div>
}

/** @param props - Session header seat. @returns a retained-version selector and recoverable load errors. */
export function VersionPicker({ sessionId, useTools, ensure, refresh, open, t }: PropsRuntime<'conversation.session.header.utilities'> & Face) {
  const [openFailed, setOpenFailed] = useState(false)
  const versions = useTools(state => state.versions)
  const failed = useTools(state => state.failed)
  useEffect(() => { void ensure() }, [ensure])
  return <div className={css.versions}>
    {versions.length > 1 && <select aria-label={t('versions')} value={sessionId}
      onFocus={() => { void refresh() }} onChange={(event) => {
        setOpenFailed(false)
        void open(SessionId(event.target.value)).catch(() => { setOpenFailed(true) })
      }}>
      {versions.map((version, index) => <option key={version.sessionId} value={version.sessionId}>
        {t('version', { number: index + 1 })}
      </option>)}
    </select>}
    {(failed || openFailed) && <span className={css.error} role="status">{t('loadFailed')} <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button></span>}
  </div>
}
