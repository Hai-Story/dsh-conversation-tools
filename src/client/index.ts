/** Optional message tools mounted through Chat-owned extension positions. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import remote from '../protocol/remote.js'
import { ToolsController } from './controller.ts'
import { AssistantActions, type ToolsInjected } from './Controls.tsx'
import { ConversationToolsSurface } from './Surface.tsx'
import { cssText } from './Controls.module.css'
import { en, zh, NS } from './locales.ts'

/** Browser services used by this optional plugin. */
export const inject = ['remote', 'slots', 'locale', 'sessions', 'uiWorkspace']

/** @param ctx - Client plugin context. @returns disposer for UI, data, and generated Remote contributions. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(remote)
  const fiber = ctx.inject(['remote.conversationTools', ...inject.slice(1)], (child) => {
    child.effect(() => child.locale.register(NS, { en, zh }))
    child.effect(() => {
      const style = document.createElement('style')
      style.dataset.dshConversationTools = 'style'
      style.textContent = cssText
      document.head.append(style)
      return () => { style.remove() }
    })
    const controllers = new Map<SessionId, ToolsController>()
    const open = async (id: SessionId): Promise<void> => {
      await child.sessions.refresh()
      child.uiWorkspace.openSession(id)
    }
    const face = (sessionId: SessionId): ToolsInjected => {
      let controller = controllers.get(sessionId)
      if (controller === undefined) {
        controller = new ToolsController(child.remote.conversationTools, sessionId, open)
        controllers.set(sessionId, controller)
      }
      return { hooks: { tools: controller.state }, ensure: controller.ensure, refresh: controller.refresh,
        star: controller.star, begin: controller.begin, change: controller.change, cancel: controller.cancel, save: controller.save, open }
    }
    child.effect(() => () => { for (const controller of controllers.values()) controller.dispose(); controllers.clear() })
    child.on('connection/reset', () => { for (const controller of controllers.values()) void controller.refresh() })
    child.slots.inject('conversation.chat.assistant-actions', () => child.slots.register({
      name: 'conversation.chat.assistant-actions', id: 'conversation-tools', order: -10, locale: NS, inject: face,
    }, AssistantActions))
    child.slots.inject('conversation.session.header.utilities', () => child.slots.register({
      name: 'conversation.session.header.utilities', id: 'conversation-tools', locale: NS, inject: face,
    }, ConversationToolsSurface))
  })
  try { await fiber } catch (error) { await fiber.dispose(); await unmount(); throw error }
  return async () => { await fiber.dispose(); await unmount() }
}
