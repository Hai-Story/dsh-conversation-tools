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
  private ready = false
  private copyLabels: readonly string[] = ['Copy', 'Copied']
  private diagnosticTimer: ReturnType<typeof setTimeout> | undefined
  private candidate = ''
  private readonly warned = new Set<string>()
  private messages: readonly MessageTarget[] = []
  private turns: readonly number[] = []

  constructor(private readonly sessionId: string, private readonly publish: (mounts: readonly Mount[]) => void,
    private readonly document: Document = window.document,
    private readonly diagnose: (issues: readonly string[]) => void = () => {}) {
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-conversation-session', 'data-chat-node-key', 'data-chat-flow', 'data-index', 'aria-describedby', 'aria-label'] })
  }

  update(messages: readonly MessageTarget[], turns: readonly number[], ready = false, copyLabels: readonly string[] = ['Copy', 'Copied']): void {
    this.ready = ready
    this.copyLabels = copyLabels
    this.messages = messages
    this.turns = turns
    this.schedule()
  }

  dispose(): void {
    this.disposed = true
    this.observer.disconnect()
    if (this.diagnosticTimer !== undefined) clearTimeout(this.diagnosticTimer)
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
    const issues = new Set<string>()
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
    if (this.ready && this.messages.length > 0 && roots.length === 0) issues.add('session-root')
    roots.forEach((root, pane) => {
      const chatReady = this.ready && root.querySelector('[data-chat-flow]') !== null
      const rows = root.querySelectorAll<HTMLElement>('[data-chat-node-key]')
      if (chatReady && this.messages.length > 0 && rows.length === 0) issues.add('message-rows')
      for (const row of rows) {
        const message = messages.get(row.dataset.chatNodeKey ?? '')
        if (message === undefined) continue
        const actions = row.querySelector<HTMLElement>('[data-clock="start"]')
        const copy = actions === null ? undefined : [...actions.querySelectorAll('button')].find(button =>
          this.copyLabels.includes(button.getAttribute('aria-label') ?? ''))
        if (chatReady && (actions === null || copy === undefined)) issues.add('message-actions')
        if (actions !== null && copy !== null && copy !== undefined) {
          seat(`${pane}:actions:${message.key}`, actions, { kind: 'actions', message } as Omit<Mount, 'id' | 'element'>, copy)
        }
      }
      if (chatReady && this.turns.length >= 2 && root.querySelector('nav') === null) issues.add('turn-rail')
      for (const mark of root.querySelectorAll<HTMLButtonElement>('nav button[data-index]')) {
        const index = Number(mark.dataset.index)
        const turn = Number.isSafeInteger(index) ? this.turns[index] : undefined
        if (turn === undefined || !/^\d+$/.test(mark.dataset.index ?? '')) {
          if (chatReady) issues.add('turn-index')
          continue
        }
        seat(`${pane}:mark:${turn}`, mark, { kind: 'mark', turn } as Omit<Mount, 'id' | 'element'>)
        const tooltipId = mark.getAttribute('aria-describedby')
        const tooltip = tooltipId === null ? null : this.document.getElementById(tooltipId)
        const preview = tooltip?.firstElementChild
        if (chatReady && tooltip !== null && !(preview instanceof HTMLElement)) issues.add('turn-preview')
        if (preview instanceof HTMLElement) seat(`${pane}:preview:${turn}`, preview, { kind: 'preview', turn } as Omit<Mount, 'id' | 'element'>)
      }
    })
    this.checkUI([...issues].sort())
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
  /** Wait for stable anchors; reflow, pagination, hidden rails and session switching are not failures. */
  private checkUI(issues: readonly string[]): void {
    const key = issues.join(',')
    if (key === this.candidate) return
    this.candidate = key
    if (this.diagnosticTimer !== undefined) clearTimeout(this.diagnosticTimer)
    this.diagnosticTimer = setTimeout(() => {
      this.diagnosticTimer = undefined
      if (this.disposed) return
      this.diagnose(issues)
      const fresh = issues.filter(issue => !this.warned.has(issue))
      for (const issue of fresh) this.warned.add(issue)
      if (fresh.length > 0) console.warn('[dsh-conversation-tools] Unsupported DSH UI anchors:', fresh.join(', '))
    }, 400)
  }

}
