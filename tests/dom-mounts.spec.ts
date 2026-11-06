// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationMounts, type Mount } from '../src/client/dom-mounts.ts'

let adapter: ConversationMounts | undefined
afterEach(() => { adapter?.dispose(); adapter=undefined; document.body.innerHTML=''; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
function fixture() {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id))
  document.body.innerHTML=`<section data-conversation-session="one">
    <div data-chat-flow><div data-chat-node-key="user:1"><div data-clock="start"><time>12:00</time><button aria-label="Other action">Other</button><button aria-label="Copy">Copy</button></div><p>Original text</p></div></div>
    <nav><button data-index="0" aria-label="Turn 1" aria-describedby="preview"></button><button data-index="1" aria-label="Turn 2"></button></nav>
    <div id="preview"><div>First question</div></div>
  </section><section data-conversation-session="other"><div data-chat-node-key="user:1"><div data-clock="start"><button aria-label="Copy">Copy</button></div></div></section>`
  let mounts: readonly Mount[]=[]
  adapter=new ConversationMounts('one', value=>{mounts=value})
  adapter.update([{key:'user:1',messageId:'message-1',turn:1,text:'Original text'}],[1,2])
  return { mounts:()=>mounts }
}
it('mounts next to Copy, decorates the matching rail, and leaves other sessions alone',async()=>{
  const f=fixture()
  await vi.waitFor(()=>expect(f.mounts()).toHaveLength(4))
  const action=f.mounts().find(m=>m.kind==='actions')!
  expect(action.element.previousElementSibling?.textContent).toBe('Copy')
  expect(document.querySelector('[data-conversation-session="other"] [data-dsh-tools-mount]')).toBeNull()
  expect(document.querySelector('p')?.textContent).toBe('Original text')
  const preview=f.mounts().find(m=>m.kind==='preview')!
  expect(preview).toMatchObject({turn:1})
  adapter?.dispose()
  expect(document.querySelectorAll('[data-dsh-tools-mount]')).toHaveLength(0)
  expect(document.querySelector('p')?.textContent).toBe('Original text')
})

it('reports stable missing anchors once, then clears the warning when the UI recovers', async () => {
  vi.useFakeTimers()
  fixture()
  adapter?.dispose()
  const diagnose = vi.fn()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  adapter = new ConversationMounts('one', () => {}, document, diagnose)
  const messages = [{ key: 'user:1', messageId: 'message-1', turn: 1, text: 'Original text' }]
  const copy = document.querySelector('[aria-label="Copy"]')!
  copy.setAttribute('aria-label', 'Changed upstream')
  adapter.update(messages, [1, 2], true)
  await vi.advanceTimersByTimeAsync(450)
  expect(diagnose).toHaveBeenLastCalledWith(['message-actions'])
  expect(warn).toHaveBeenCalledOnce()
  adapter.update(messages, [1, 2], true)
  await vi.advanceTimersByTimeAsync(450)
  expect(warn).toHaveBeenCalledOnce()
  copy.setAttribute('aria-label', 'Copied')
  await vi.advanceTimersByTimeAsync(450)
  expect(diagnose).toHaveBeenLastCalledWith([])
})

it('does not diagnose a hidden single-turn rail or an opening session', async () => {
  vi.useFakeTimers()
  fixture()
  adapter?.dispose()
  document.querySelector('nav')?.remove()
  const diagnose = vi.fn()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  adapter = new ConversationMounts('one', () => {}, document, diagnose)
  const messages = [{ key: 'user:1', messageId: 'message-1', turn: 1, text: 'text' }]
  adapter.update(messages, [1], true)
  await vi.advanceTimersByTimeAsync(450)
  document.querySelector('[data-conversation-session="one"]')?.remove()
  adapter.update(messages, [1], false)
  await vi.advanceTimersByTimeAsync(450)
  expect(warn).not.toHaveBeenCalled()
  expect(diagnose).not.toHaveBeenCalled()
})
it('releases removed rows and observes newly loaded rows without reading their text',async()=>{
  const f=fixture()
  await vi.waitFor(()=>expect(f.mounts().some(m=>m.kind==='actions')).toBe(true))
  document.querySelector('[data-conversation-session="one"] [data-chat-node-key]')?.remove()
  await vi.waitFor(()=>expect(f.mounts().filter(m=>m.kind==='actions')).toHaveLength(0))
  expect(f.mounts().filter(m=>m.kind==='mark')).toHaveLength(2)
})

it('keeps action mounts when streaming adds rows or refreshes the turn outline', async () => {
  const f=fixture()
  await vi.waitFor(()=>expect(f.mounts().some(m=>m.kind==='actions')).toBe(true))
  const editor=f.mounts().find(m=>m.kind==='actions')!.element
  const input=document.createElement('textarea')
  editor.append(input)
  input.value='unsent draft'
  input.focus()
  adapter?.update([{key:'user:1',messageId:'message-1',turn:1,text:'Original text'}],[1,2,3])
  await vi.waitFor(()=>expect(f.mounts().find(m=>m.kind==='actions')?.element).toBe(editor))
  expect(input.value).toBe('unsent draft')
  expect(document.activeElement).toBe(input)
})
