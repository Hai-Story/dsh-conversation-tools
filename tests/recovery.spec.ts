// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { recoveryStore, type RecoveryTicket } from '../src/client/recovery.ts'

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

it('preserves partial-edit identity and semantic draft references through a tab reload', () => {
  const report = vi.fn()
  const ticket: RecoveryTicket = { draft: { messageId: MessageId('message'), requestId: 'request' as SessionRequestId,
    text: 'replacement', recoverableSessionId: SessionId('child'), pending: false, failed: true, failure: 'partial' },
    previous: { text: 'notes.txt', references: [{ source: 'file', ref: 'notes.txt', label: 'notes.txt',
      clipboardText: 'notes.txt', offset: 0, length: 9, appearance: 'file' }], quotes: [] } }
  recoveryStore('source', report).write(ticket)
  expect(recoveryStore('source', report).read()).toEqual(ticket)
  expect(recoveryStore('other-session', report).read()).toBeUndefined()
  recoveryStore('source', report).write(undefined)
  expect(recoveryStore('source', report).read()).toBeUndefined()
  expect(report).not.toHaveBeenCalled()
})

it('tolerates unavailable browser storage and malformed recovery data', () => {
  const report = vi.fn()
  sessionStorage.setItem('dsh.conversation-tools.recovery.source', '{broken')
  const store = recoveryStore('source', report)
  expect(store.read()).toBeUndefined()
  expect(report).toHaveBeenCalledOnce()
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage denied') })
  expect(() => store.write(undefined)).not.toThrow()
  expect(report).toHaveBeenCalledTimes(2)
})
