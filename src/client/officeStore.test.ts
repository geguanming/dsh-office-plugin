import { describe, expect, it } from 'vitest'
import { sessionWork } from './officeStore.ts'
import type { OfficeConversationSnapshot, RunningToolCall } from './runtimeTypes.ts'

const snapshot = (call: RunningToolCall): OfficeConversationSnapshot => ({
  sessionId: 'child', running: true, blank: false, openState: 'open',
  nodes: [], partial: null, runningCalls: [call],
})
const head = { callId: 'report', name: 'send_message', turn: 1, step: 1, time: 1, callView: null, subCalls: [] }
describe('live child work monitor', () => {
  it('renders tool preparation before finalized arguments exist', () => {
    expect(sessionWork(snapshot({ ...head, phase: 'preparing' })))
      .toEqual([{ kind: 'tool', text: 'send_message（正在生成参数…）' }])
  })
  it('renders the subsequent dispatched call with its final argument text', () => {
    expect(sessionWork(snapshot({ ...head, phase: 'start', argsRaw: ' {"message":"ready"} ' })))
      .toEqual([{ kind: 'tool', text: 'send_message {"message":"ready"}' }])
  })
  it('tolerates missing argument text without removing the entire office', () => {
    expect(sessionWork(snapshot(head))).toEqual([{ kind: 'tool', text: 'send_message' }])
  })
})
