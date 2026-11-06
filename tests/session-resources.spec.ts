import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionToolsRegistry, type SessionTools } from '../src/client/session-resources.ts'

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
})
