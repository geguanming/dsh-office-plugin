import { describe, expect, it, vi } from 'vitest'
import { adaptRuntime, type RuntimeSources } from './runtimeAdapter.ts'
import type { Observable, OfficeSessionSummary, PendingInteractionFace } from './runtimeTypes.ts'

function store<T>(initial: T): Observable<T> & { set(value: T): void } {
  let state = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => state, subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb) } },
    set(value) { state = value; for (const cb of listeners) cb() } }
}
function fixture() {
  const row: OfficeSessionSummary = { id: 'a', displayTitle: 'A', running: false, blank: false, updatedAt: 1, retainedBy: { mainView: 1 } }
  const catalog = store({ ids: ['a'], byId: { a: row } })
  const status = store(new Map<string, { running: boolean | undefined; pendingInteraction: PendingInteractionFace | undefined }>())
  const life = store({ sessionId: 'a', running: false, blank: false, openState: 'open' as const })
  const chat = store({ legacy: { nodes: [], partial: null, runningCalls: [] } })
  const release = vi.fn(), prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  const face = { ...life, prompt }
  const retain = vi.fn(() => ({ binding: { session: face }, ready: Promise.resolve(), release }))
  const openSession = vi.fn()
  const sources: RuntimeSources = { sessions: { list: catalog, scope: () => ({}), sessionOf: () => face,
    retain, binding: () => ({ session: face }) }, uiSession: { sessionStatus: status },
    uiConversation: { binding: () => ({ target: () => chat }) }, uiWorkspace: { openSession } }
  return { office: adaptRuntime(sources), catalog, status, retain, release, prompt, openSession }
}
describe('DSH 0.2.1 adapter', () => {
  it('shows real addressed children that are absent from the top-level list', () => {
    const { office, catalog } = fixture()
    catalog.set({ ids: ['a'], byId: { a: { ...catalog.getSnapshot().byId.a,
      projectionValues: { subagentCatalog: [{ id: 'child', label: 'Worker', mode: 'one-shot', createdAt: 2 }] } } } })
    expect(office.list.getSnapshot().byId.child?.parentId).toBe('a')
    expect(office.list.getSnapshot().ids).toContain('child')
  })
  it('tracks mainView selection and keeps stable snapshots', () => {
    const { office, catalog } = fixture()
    expect(office.list.getSnapshot().current).toBe('a')
    expect(office.list.getSnapshot()).toBe(office.list.getSnapshot())
    catalog.set({ ids: ['a'], byId: { a: { ...catalog.getSnapshot().byId.a, retainedBy: {} } } })
    expect(office.list.getSnapshot().current).toBeUndefined()
  })
  it('tracks running and clears resolved approvals without stale state', () => {
    const { office, status } = fixture()
    status.set(new Map([['a', { running: true, pendingInteraction: { kind: 'approval', key: 'k', sessionId: 'a' } }]]))
    expect(office.list.getSnapshot().byId.a?.running).toBe(true)
    expect(office.list.getSnapshot().byId.a?.pendingInteraction).toBe('approval')
    status.set(new Map())
    expect(office.list.getSnapshot().byId.a?.pendingInteraction).toBeUndefined()
  })
  it('retains only subscribed monitors and releases them on close', async () => {
    const { office, retain, release } = fixture()
    const face = office.sessionOf(office.scope('a'))!
    expect(retain).not.toHaveBeenCalled()
    expect(face.getSnapshot()).toBe(face.getSnapshot())
    const unsubscribe = face.subscribe(() => {})
    await Promise.resolve()
    expect(retain).toHaveBeenCalledOnce()
    unsubscribe()
    expect(release).toHaveBeenCalledOnce()
  })
  it('routes approval answers and navigation through current APIs', async () => {
    const { office, status, openSession } = fixture()
    const answer = vi.fn(async () => {})
    status.set(new Map([['a', { running: false, pendingInteraction: { kind: 'approval', key: 'k', sessionId: 'a', answer } }]]))
    await office.sessionOf(office.scope('a'))!.getSnapshot().pending![0].respond({ value: { outcome: 'allowed-once' } })
    expect(answer).toHaveBeenCalledWith('allowed-once')
    office.open('a'); expect(openSession).toHaveBeenCalledWith('a')
  })
  it('releases a temporary reference after sending a boss order', async () => {
    const { office, release, prompt } = fixture()
    await office.sessionOf(office.scope('a'))!.prompt([{ type: 'text', text: 'hello' }], 'queue')
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'hello' }], 'queue')
    expect(release).toHaveBeenCalledOnce()
  })
})
