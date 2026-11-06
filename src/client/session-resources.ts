/** Controllers live exactly as long as the retained Session binding, not the browser process. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { initialToolsView, type ToolsController, type ToolsView } from './controller.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { NativeComposerEdit } from './native-composer.ts'

export interface SessionTools { controller: ToolsController; composer: NativeComposerEdit }
const unavailable: ToolsView = { ...initialToolsView, available: false }

/** Keep a cached slot face reactive when its binding disappears or is replaced. */
export function observeSessionTools(resolve: () => SessionTools | undefined,
  changes: Pick<HostObservable<unknown>, 'subscribe'>): HostObservable<ToolsView> {
  return {
    getSnapshot: () => resolve()?.controller.state.getSnapshot() ?? unavailable,
    subscribe(listener) {
      let current: SessionTools | undefined
      let unsubscribe = () => {}
      const changed = () => {
        const next = resolve()
        if (next === current) return
        unsubscribe()
        current = next
        unsubscribe = next?.controller.state.subscribe(listener) ?? (() => {})
        listener()
      }
      const unbind = changes.subscribe(changed)
      changed()
      return () => { unbind(); unsubscribe() }
    },
  }
}

export class SessionToolsRegistry {
  private readonly entries = new Map<SessionId, { binding: SessionBinding; value: SessionTools }>()
  private disposed = false
  get(binding: SessionBinding, create: () => SessionTools): SessionTools | undefined {
    if (this.disposed) return undefined
    const previous = this.entries.get(binding.sessionId)
    if (previous?.binding === binding) return previous.value
    if (previous !== undefined) this.release(binding.sessionId, previous)
    const entry = { binding, value: create() }
    this.entries.set(binding.sessionId, entry)
    binding.ctx.effect(() => () => this.release(binding.sessionId, entry))
    return entry.value
  }
  refresh(): void { for (const { value } of this.entries.values()) void value.controller.refresh() }
  dispose(): void { this.disposed = true; for (const [id, entry] of this.entries) this.release(id, entry) }
  private release(id: SessionId, entry: { value: SessionTools }): void {
    if (this.entries.get(id) !== entry) return
    this.entries.delete(id)
    entry.value.controller.dispose()
    entry.value.composer.dispose()
  }
}
