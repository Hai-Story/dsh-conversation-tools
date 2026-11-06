import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
/** Session-scoped controls portal into existing DSH chrome without replacing its renderers. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { ConversationMounts, type Mount, type MessageTarget } from './dom-mounts.ts'
import { UserActions, MessageEditor, VersionPicker, type Face } from './Controls.tsx'
import css from './Controls.module.css'

type Props = PropsRuntime<'conversation.session.header.utilities'> & Face

export function ConversationToolsSurface(props: Props) {
  const order = props.useChat(snapshot => snapshot.order)
  const nodes = props.useChat(snapshot => snapshot.nodes)
  const loaded = props.useChat(snapshot => snapshot.navigation.items())
  const outline = props.useProjection('turnOutline')
  const starred = props.useTools(state => state.starredTurns)
  const messages = useMemo<readonly MessageTarget[]>(() => order.flatMap(key => {
    const node = nodes.get(key) as ChatNode | undefined
    if ((node?.kind !== 'user' && node?.kind !== 'steering') || node.data.messageId === undefined) return []
    if (node.location.kind !== 'turn' && node.location.kind !== 'step') return []
    return [{ key, messageId: node.data.messageId, turn: node.location.turn.turn,
      text: node.data.content.filter(block => block.type === 'text').map(block => block.text).join('') }]
  }), [order, nodes])
  const turns = useMemo(() => {
    const result = new Set(loaded.map(item => item.turn))
    if (Array.isArray(outline)) for (const entry of outline) {
      if (entry !== null && typeof entry === 'object' && 'turn' in entry && Number.isSafeInteger(entry.turn)) result.add(Number(entry.turn))
    }
    return [...result].sort((a, b) => a - b)
  }, [outline, loaded])
  const [mounts, setMounts] = useState<readonly Mount[]>([])
  const adapterRef = useRef<ConversationMounts | null>(null)
  useEffect(() => {
    const adapter = new ConversationMounts(props.sessionId, setMounts)
    adapterRef.current = adapter
    return () => { adapterRef.current = null; adapter.dispose() }
  }, [props.sessionId])
  useEffect(() => { adapterRef.current?.update(messages, turns) }, [props.sessionId, messages, turns])
  return <>
    <VersionPicker {...props} />
    {mounts.map(mount => {
      const content = 'message' in mount
        ? mount.kind === 'actions'
          ? <UserActions {...props} turn={mount.message.turn} text={mount.message.text} messageId={MessageId(mount.message.messageId)} />
          : <MessageEditor {...props} turn={mount.message.turn} text={mount.message.text} messageId={MessageId(mount.message.messageId)} />
        : starred.includes(mount.turn)
          ? <span className={mount.kind === 'mark' ? css.mark : css.preview} role="img" aria-label={props.t('starred')}>★</span> : null
      return createPortal(content, mount.element, mount.id)
    })}
  </>
}
