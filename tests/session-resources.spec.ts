import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ToolsController } from '../src/client/controller.ts'
import { observeSessionTools, SessionToolsRegistry, type SessionTools } from '../src/client/session-resources.ts'

it('releases controllers with their session scope and refreshes only retained sessions', async () => {
  const ctx = new Context()
  const registry = new SessionToolsRegistry()
  const resources = () => ({ controller: { refresh: vi.fn(async () => {}), dispose: vi.fn() }, composer: { dispose: vi.fn() } })
  const first = resources(), next = resources()
  const oldScope = await ctx.plugin(scope => {
    const binding = { ctx: scope, sessionId: SessionId('session') } as SessionBinding
    const create = vi.fn(() => first as unknown as SessionTools)
    expect(registry.get(binding, create)).toBe(first)
    expect(registry.get(binding, create)).toBe(first)
    expect(create).toHaveBeenCalledOnce()
  })
  const newScope = await ctx.plugin(scope => {
    registry.get({ ctx: scope, sessionId: SessionId('session') } as SessionBinding, () => next as unknown as SessionTools)
  })
  expect(first.controller.dispose).toHaveBeenCalledOnce()
  expect(first.composer.dispose).toHaveBeenCalledOnce()
  await oldScope.dispose()
  registry.refresh()
  expect(first.controller.refresh).not.toHaveBeenCalled()
  expect(next.controller.refresh).toHaveBeenCalledOnce()
  expect(next.controller.dispose).not.toHaveBeenCalled()
  await newScope.dispose()
  registry.refresh()
  registry.dispose()
  expect(next.controller.refresh).toHaveBeenCalledOnce()
  expect(next.controller.dispose).toHaveBeenCalledOnce()
  expect(next.composer.dispose).toHaveBeenCalledOnce()
  const create = vi.fn(() => next as unknown as SessionTools)
  expect(registry.get({ ctx, sessionId: SessionId('session') } as SessionBinding, create)).toBeUndefined()
  expect(create).not.toHaveBeenCalled()
})

it('keeps a cached face disabled without a binding and reconnects it to each live generation', async () => {
  const changes = createSnapshotStore(0)
  let current: SessionTools | undefined
  const source = observeSessionTools(() => current, changes)
  expect(source.getSnapshot().available).toBe(false)
  expect(source.getSnapshot()).toBe(source.getSnapshot())
  const listener = vi.fn()
  const unsubscribe = source.subscribe(listener)
  const make = () => ({ controller: new ToolsController({
    snapshot: async () => ({ ok: true, value: { starredTurns: [1], versions: [] } }), star: vi.fn(), edit: vi.fn(),
  }, SessionId('source'), vi.fn()), composer: { dispose: vi.fn() } as unknown as SessionTools['composer'] })
  const first = make()
  current = first
  changes.set(1)
  expect(source.getSnapshot().available).toBe(true)
  await first.controller.ensure()
  expect(source.getSnapshot()).toMatchObject({ loaded: true, starredTurns: [1] })
  current = undefined
  changes.set(2)
  expect(source.getSnapshot().available).toBe(false)
  listener.mockClear()
  first.controller.failStart(new Error('obsolete generation'))
  expect(listener).not.toHaveBeenCalled()
  current = make()
  changes.set(3)
  expect(source.getSnapshot()).toMatchObject({ available: true, loaded: false, error: null })
  unsubscribe()
  listener.mockClear()
  await current.controller.ensure()
  changes.set(4)
  expect(listener).not.toHaveBeenCalled()
})
