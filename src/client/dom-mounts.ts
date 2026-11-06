/** DOM adapters for DSH 0.2.2-rc.1's unmodified message action rows and virtual turn rail. */
export interface MessageTarget { key: string; messageId: string; turn: number; text: string }
export type Mount = { id: string; element: HTMLElement } & (
  | { kind: 'actions'; message: MessageTarget }
  | { kind: 'mark' | 'preview'; turn: number }
)

/** Only plugin-owned children are inserted/removed. Message identity comes from the Chat projection, never DOM text. */
export class ConversationMounts {
  private readonly owned = new Map<string, Mount>()
  private readonly observer: MutationObserver
  private frame: number | undefined
  private disposed = false
  private messages: readonly MessageTarget[] = []
  private turns: readonly number[] = []

  constructor(private readonly sessionId: string, private readonly publish: (mounts: readonly Mount[]) => void,
    private readonly document: Document = window.document) {
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-conversation-session', 'data-chat-node-key', 'data-index', 'aria-describedby'] })
  }

  update(messages: readonly MessageTarget[], turns: readonly number[]): void {
    this.messages = messages
    this.turns = turns
    this.schedule()
  }

  dispose(): void {
    this.disposed = true
    this.observer.disconnect()
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    for (const mount of this.owned.values()) mount.element.remove()
    this.owned.clear()
  }

  private schedule(): void {
    if (this.disposed || this.frame !== undefined) return
    this.frame = requestAnimationFrame(() => { this.frame = undefined; this.scan() })
  }

  private scan(): void {
    const next = new Map<string, Mount>()
    const messages = new Map(this.messages.map(message => [message.key, message]))
    const roots = [...this.document.querySelectorAll<HTMLElement>('[data-conversation-session]')]
      .filter(root => root.dataset.conversationSession === this.sessionId)
    const seat = (id: string, parent: HTMLElement, details: Omit<Mount, 'id' | 'element'>, after?: Element): void => {
      const previous = this.owned.get(id)
      let element = previous?.element
      if (element?.parentElement !== parent) {
        // Another mounted header for this same pane may already own these controls.
        if ([...parent.children].some(child => child.getAttribute('data-dsh-tools-mount') === id)) return
        element = this.document.createElement('span')
        element.dataset.dshToolsMount = id
        if (details.kind === 'actions') { element.style.display = 'inline-flex'; element.style.gap = '8px' }
        if (after !== undefined) after.after(element)
        else parent.append(element)
      }
      next.set(id, { ...details, id, element } as Mount)
    }
    roots.forEach((root, pane) => {
      for (const row of root.querySelectorAll<HTMLElement>('[data-chat-node-key]')) {
        const message = messages.get(row.dataset.chatNodeKey ?? '')
        if (message === undefined) continue
        const actions = row.querySelector<HTMLElement>('[data-clock="start"]')
        const copy = actions?.querySelector('button')
        if (actions !== null && copy !== null && copy !== undefined) {
          seat(`${pane}:actions:${message.key}`, actions, { kind: 'actions', message } as Omit<Mount, 'id' | 'element'>, copy)
        }
      }
      for (const mark of root.querySelectorAll<HTMLButtonElement>('nav button[data-index]')) {
        const index = Number(mark.dataset.index)
        const turn = Number.isSafeInteger(index) ? this.turns[index] : undefined
        if (turn === undefined) continue
        seat(`${pane}:mark:${turn}`, mark, { kind: 'mark', turn } as Omit<Mount, 'id' | 'element'>)
        const tooltipId = mark.getAttribute('aria-describedby')
        const tooltip = tooltipId === null ? null : this.document.getElementById(tooltipId)
        const preview = tooltip?.firstElementChild
        if (preview instanceof HTMLElement) seat(`${pane}:preview:${turn}`, preview, { kind: 'preview', turn } as Omit<Mount, 'id' | 'element'>)
      }
    })
    let changed = next.size !== this.owned.size
    for (const [id, mount] of this.owned) if (next.get(id)?.element !== mount.element) { mount.element.remove(); changed = true }
    for (const [id, mount] of next) {
      const previous = this.owned.get(id)
      if (previous?.element !== mount.element || ('message' in mount && (!previous || !('message' in previous) || previous.message !== mount.message))) changed = true
    }
    this.owned.clear()
    for (const [id, mount] of next) this.owned.set(id, mount)
    if (changed) this.publish([...next.values()])
  }
}
