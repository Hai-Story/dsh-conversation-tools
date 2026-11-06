/** Keyless test provider, mounted only by tests/browser.mjs. */
import { appendFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
export const name = 'conversation-tools-test-model'
export const inject = ['llm']
class FixtureModel extends LlmAdapter {
  async listModels() { return [{ id: 'fixture', name: 'Fixture' }] }
  async resolveModel(provider, id) { return { provider, id, name: 'Fixture' } }
  async * stream(request) {
    await appendFile(process.env.DSH_CONVERSATION_TEST_REQUESTS, JSON.stringify(request.messages) + '\n')
    const last = request.messages.findLast(message => message.role === 'user' && message.source?.kind === 'user')
    const prompt = last?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? 'CONTINUED'
    const event = stage => appendFile(process.env.DSH_CONVERSATION_TEST_EVENTS, JSON.stringify({ prompt, stage }) + '\n')
    await event('started')
    if (prompt.startsWith('RUNNING_')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: `Streaming: ${prompt}` }
      try {
        while (!request.signal?.aborted) {
          await delay(100, undefined, { signal: request.signal })
          await event('tick')
          yield { type: 'text-delta', index: 0, text: '.' }
        }
      } catch (error) {
        if (!request.signal?.aborted) throw error
      } finally {
        await event('aborted')
        // Model teardown deliberately settles later than its cancellation notification.
        await delay(200)
        await event('settled')
      }
      return
    }
    const text = `Reply: ${prompt}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
    await event('settled')
  }
}
export async function apply(ctx) {
  ctx.effect(() => ctx.llm.registerAdapter(['conversation-tools-test'], new FixtureModel()))
}
