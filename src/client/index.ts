/** Optional message tools mounted through Chat-owned extension positions. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import remote from '../protocol/remote.js'
import { SessionToolsRegistry } from './session-resources.ts'
import { ToolsController } from './controller.ts'
import { NativeComposerEdit, type NativeEditInput } from './native-composer.ts'
import { AssistantActions, EditComposerNotice, type ToolsInjected } from './Controls.tsx'
import { ConversationToolsSurface } from './Surface.tsx'
import { cssText } from './Controls.module.css'
import { en, zh, NS } from './locales.ts'

/** Browser services used by this optional plugin. */
export const inject = ['remote', 'slots', 'locale', 'sessions', 'uiWorkspace', 'conversation']

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
    const resources = new SessionToolsRegistry()
    const t = child.locale.bind(NS)
    const open = async (id: SessionId): Promise<void> => {
      await child.sessions.refresh()
      child.uiWorkspace.openSession(id)
    }
    const face = (sessionId: SessionId): ToolsInjected => {
      const binding = child.sessions.binding(sessionId)
      if (binding === undefined) throw new Error('Conversation is not retained')
      const { controller, composer } = resources.get(binding, () => {
        const controller = new ToolsController(child.remote.conversationTools, sessionId,
          (operation, error) => child.logger.warn(`conversation-tools: ${operation}`, error))
        const composer = new NativeComposerEdit(controller, () => {
          const scope = child.sessions.scope(sessionId)
          if (scope === undefined) throw new Error('Conversation is not retained')
          const input = child.conversation.input.for(scope)
          if (!('draftSnapshot' in input)) throw new Error('Unsupported native composer')
          const native = input as NativeEditInput
          return { input: native,
            claim: claim => scope.bail('slash/input-begin-command', { claim,
              span: { start: 0, end: 0, draftRev: native.state.getSnapshot().draftRev } }) === true,
            onDispose: cleanup => scope.effect(() => cleanup),
          }
        }, open, () => {
          const failure = controller.state.getSnapshot().editing?.failure
          return t(failure === 'busy' ? 'busy' : failure === 'persistence' ? 'persistenceUnavailable'
            : failure === 'partial' ? 'partial' : failure === 'recovery-unavailable' ? 'recoveryUnavailable' : 'failed')
        })
        return { controller, composer }
      })
      const openVersion = async (id: SessionId): Promise<void> => {
        try { await open(id); controller.dismissError() } catch (error) { controller.failOpen(id, error) }
      }
      return { hooks: { tools: controller.state }, ensure: controller.ensure, refresh: controller.refresh,
        retry: async () => {
          const error = controller.state.getSnapshot().error
          if (error?.kind === 'open') await openVersion(error.sessionId)
          else await controller.retry()
        },
        dismissError: controller.dismissError, diagnose: controller.diagnose,
        star: controller.star, begin: composer.begin, resume: composer.resume, cancel: composer.cancel, open: openVersion }
    }
    child.effect(() => () => resources.dispose())
    child.on('connection/reset', () => resources.refresh())
    child.slots.inject('conversation.input.dock', () => child.slots.register({
      name: 'conversation.input.dock', id: 'conversation-tools-edit', order: -20, locale: NS, inject: face,
    }, EditComposerNotice))
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
