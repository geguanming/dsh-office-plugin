/** DSH 0.2.1: catalog + UI status + explicitly retained Conversation views. */
import type {
  Observable, OfficeConversationSnapshot, OfficeSessionsState, PendingInteractionFace,
  PendingWaitFace, SessionsServiceFace, UiConversationFace, UiSessionFace,
} from './runtimeTypes.ts'
import type { SessionFace, SessionsFace } from './OfficeCanvas.tsx'

const EMPTY_NODES: OfficeConversationSnapshot['nodes'] = []
const EMPTY_CALLS: OfficeConversationSnapshot['runningCalls'] = []
const EMPTY_PENDING: readonly PendingWaitFace[] = []

export interface RuntimeSources {
  sessions: SessionsServiceFace
  uiConversation: UiConversationFace
  uiSession: UiSessionFace
  uiWorkspace: { openSession(id: string): void }
}

function pendingWait(p: PendingInteractionFace): PendingWaitFace {
  return {
    kind: p.kind === 'approval' ? 'approval' : 'question', key: p.key, sessionId: p.sessionId,
    payload: { approvalId: p.key, toolName: p.toolName, callId: p.callId, reason: p.reason },
    async respond(result) {
      const outcome = (result as { value?: { outcome?: 'allowed-once' | 'rejected' } })?.value?.outcome
      if (p.kind !== 'approval' || !p.answer || !outcome) return { accepted: false }
      await p.answer(outcome)
      return { accepted: true }
    },
  }
}

export function adaptRuntime(raw: RuntimeSources): SessionsFace {
  const { sessions, uiSession, uiConversation, uiWorkspace } = raw
  let lastCatalog: unknown, lastStatus: unknown, cachedList: OfficeSessionsState
  const list: Observable<OfficeSessionsState> = {
    subscribe(cb) {
      const a = sessions.list.subscribe(cb), b = uiSession.sessionStatus.subscribe(cb)
      return () => { a(); b() }
    },
    getSnapshot() {
      const catalog = sessions.list.getSnapshot(), status = uiSession.sessionStatus.getSnapshot()
      if (catalog === lastCatalog && status === lastStatus) return cachedList
      const byId: OfficeSessionsState['byId'] = {}
      for (const [id, row] of Object.entries(catalog.byId)) {
        if (!row) continue
        const state = status.get(id)
        byId[id] = { ...row, running: state?.running ?? row.running,
          pendingInteraction: state?.pendingInteraction ? (state.pendingInteraction.kind === 'approval' ? 'approval' : 'question') : undefined }
      }
      // mainView is the public reference source owned by DSH's selected conversation.
      const current = Object.values(byId).find(row => (row?.retainedBy?.mainView ?? 0) > 0)?.id
      // Addressed children can be absent from the top-level catalog; use durable
      // parent projections for membership, never manufacture demonstration agents.
      for (const [parentId, parent] of Object.entries(catalog.byId)) {
        const children = catalog.projectionsBySession?.[parentId]?.values.subagentCatalog ?? parent?.projectionValues?.subagentCatalog
        for (const child of children ?? []) {
          if (child.mode === 'external' || byId[child.id]) continue
          const state = status.get(child.id)
          byId[child.id] = { id: child.id, parentId, origin: 'subagent',
            displayTitle: child.label ?? child.id, running: state?.running ?? false,
            pendingInteraction: state?.pendingInteraction ? (state.pendingInteraction.kind === 'approval' ? 'approval' : 'question') : undefined,
            blank: false, updatedAt: child.createdAt }
        }
      }
      cachedList = { ids: Object.keys(byId), byId, current, subagentsByParent: {} }
      lastCatalog = catalog; lastStatus = status
      return cachedList
    },
  }
  const faces = new Map<string, SessionFace>()
  const tokens = new Map<string, object>()
  const ids = new WeakMap<object, string>()
  const faceFor = (id: string): SessionFace => {
    const existing = faces.get(id)
    if (existing) return existing
    let lastLife: unknown, lastChat: unknown, lastPending: unknown, lastRow: unknown
    let snapshot: OfficeConversationSnapshot | undefined
    const face: SessionFace = {
      subscribe(cb) {
        // Only visible monitors/current conversation acquire history, never every idle employee.
        const reference = sessions.retain(id, { source: 'officeMonitor' })
        const target = uiConversation.binding(id).target('chat')
        const a = reference.binding.session.subscribe(cb), b = target.subscribe(cb)
        const c = uiSession.sessionStatus.subscribe(cb), d = sessions.list.subscribe(cb)
        let active = true
        void reference.ready.then(() => { if (active) cb() }, () => { if (active) cb() })
        return () => { active = false; a(); b(); c(); d(); reference.release() }
      },
      getSnapshot() {
        const binding = sessions.binding(id)
        const life = binding?.session.getSnapshot()
        const chat = binding ? uiConversation.binding(id).target('chat').getSnapshot() : undefined
        const pending = uiSession.sessionStatus.getSnapshot().get(id)?.pendingInteraction
        const row = sessions.list.getSnapshot().byId[id]
        if (snapshot && life === lastLife && chat === lastChat && pending === lastPending && row === lastRow) return snapshot
        snapshot = { sessionId: id, running: life?.running ?? row?.running ?? false,
          blank: life?.blank ?? row?.blank ?? true, openState: life?.openState ?? 'cold',
          nodes: chat?.legacy?.nodes ?? EMPTY_NODES, runningCalls: chat?.legacy?.runningCalls ?? EMPTY_CALLS,
          partial: chat?.legacy?.partial ?? null, pending: pending ? [pendingWait(pending)] : EMPTY_PENDING }
        lastLife = life; lastChat = chat; lastPending = pending; lastRow = row
        return snapshot
      },
      async open() {
        const reference = sessions.retain(id, { source: 'officeMonitor' })
        try { await reference.ready } finally { reference.release() }
      },
      async prompt(content, mode) {
        const reference = sessions.retain(id, { source: 'officeMonitor' })
        try { await reference.ready; return await reference.binding.session.prompt(content, mode) }
        finally { reference.release() }
      },
    }
    faces.set(id, face)
    return face
  }
  return { list,
    scope(id) {
      if (!tokens.has(id)) { const token = {}; tokens.set(id, token); ids.set(token, id) }
      return tokens.get(id)
    },
    sessionOf(token) { const id = typeof token === 'object' && token !== null ? ids.get(token) : undefined; return id ? faceFor(id) : undefined },
    open: id => uiWorkspace.openSession(id),
  }
}
