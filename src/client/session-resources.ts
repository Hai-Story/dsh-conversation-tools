/** Controllers live exactly as long as the retained Session binding, not the browser process. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ToolsController } from './controller.ts'
import type { NativeComposerEdit } from './native-composer.ts'

export interface SessionTools { controller: ToolsController; composer: NativeComposerEdit }
export class SessionToolsRegistry {
  private readonly entries = new Map<SessionId, { binding: SessionBinding; value: SessionTools }>()
  get(binding: SessionBinding, create: () => SessionTools): SessionTools {
    const previous = this.entries.get(binding.sessionId)
    if (previous?.binding === binding) return previous.value
    if (previous !== undefined) this.release(binding.sessionId, previous)
    const entry = { binding, value: create() }
    this.entries.set(binding.sessionId, entry)
    binding.ctx.effect(() => () => this.release(binding.sessionId, entry))
    return entry.value
  }
  refresh(): void { for (const { value } of this.entries.values()) void value.controller.refresh() }
  dispose(): void { for (const [id, entry] of this.entries) this.release(id, entry) }
  private release(id: SessionId, entry: { value: SessionTools }): void {
    if (this.entries.get(id) !== entry) return
    this.entries.delete(id)
    entry.value.composer.dispose()
    entry.value.controller.dispose()
  }
}
