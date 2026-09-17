/**
 * dsh 0.1.5 运行时适配层：把 uiConversation/uiSession 拆出去的数据重新拼回
 * 插件内部沿用的 0.1.2 形状（OfficeConversationSnapshot / 带 pendingInteraction
 * 的 SessionSummary），OfficeCanvas/officeStore 无需改动。
 *
 * 换算关系：
 * - 会话内容：face.getSnapshot()（只剩生命周期）+ uiConversation.binding(id)
 *   .target('chat').legacy（nodes/partial/runningCalls）→ OfficeConversationSnapshot；
 * - 待办：uiSession.pendingInteractions（Map）→ summary.pendingInteraction 与
 *   snapshot.pending（PendingApproval.answer 包成旧的 respond 形状）。
 *
 * 所有 getSnapshot 都做了引用记忆：底层三份来源都没变时返回同一对象，
 * 否则 useSyncExternalStore 会因快照引用抖动无限重渲染。
 */
import type {
  ChatSnapshotFace, Observable, OfficeConversationSnapshot, OfficeNode, OfficeSessionsState,
  OfficeSessionSummary, PendingInteractionFace, PendingWaitFace, RawSessionFace, RunningToolCall,
  SessionsServiceFace, UiConversationFace, UiSessionFace,
} from './runtimeTypes.ts'
import type { SessionFace, SessionsFace } from './OfficeCanvas.tsx'

const EMPTY_NODES: readonly OfficeNode[] = []
const EMPTY_CALLS: readonly RunningToolCall[] = []
const EMPTY_PENDING: readonly PendingWaitFace[] = []

export interface RuntimeSources {
  sessions: SessionsServiceFace
  uiConversation?: UiConversationFace
  uiSession?: UiSessionFace
}

/** 0.1.5 里 plan-review 并入 question，approval 保持原名 */
function pendingStatusOf(p: PendingInteractionFace): 'approval' | 'question' {
  return p.kind === 'approval' ? 'approval' : 'question'
}

/** PendingApproval（answer 模型）包成旧的 PendingWaitFace（respond 模型） */
function toPendingWait(p: PendingInteractionFace): PendingWaitFace {
  if (p.kind === 'approval') {
    return {
      kind: 'approval',
      key: p.key,
      sessionId: p.sessionId,
      // approvalId 在 0.1.5 不再外露（answer 内部完成关联），用 key 占位让完整性检查通过
      payload: { approvalId: p.key, toolName: p.toolName, callId: p.callId, reason: p.reason },
      respond(result: unknown) {
        const value = (result as { value?: { outcome?: 'allowed-once' | 'rejected' } } | undefined)?.value
        if (p.answer === undefined || value?.outcome === undefined) {
          return Promise.resolve({ accepted: false })
        }
        return p.answer(value.outcome).then(() => ({ accepted: true }))
      },
    }
  }
  return {
    kind: 'question',
    key: p.key,
    sessionId: p.sessionId,
    payload: {},
    respond: () => Promise.resolve({ accepted: false }),
  }
}

export function adaptRuntime(raw: RuntimeSources): SessionsFace {
  const { sessions, uiConversation, uiSession } = raw
  // scope 是不透明 AgentContext，sessionOf 时需要还原 session id
  const scopeIds = new WeakMap<object, string>()

  const scopeRaw = (id: string): unknown | undefined => {
    const scoped = sessions.scope(id)
    if (scoped !== null && (typeof scoped === 'object' || typeof scoped === 'function')) {
      scopeIds.set(scoped as object, id)
    }
    return scoped
  }

  const pendingMap = (): ReadonlyMap<string, PendingInteractionFace> | undefined =>
    uiSession?.pendingInteractions.getSnapshot()

  // ---- list：在 SessionListState 上合成 pendingInteraction ----
  let listCache: {
    rawState: OfficeSessionsState
    rawMap: ReadonlyMap<string, PendingInteractionFace> | undefined
    merged: OfficeSessionsState
  } | undefined

  const list: Observable<OfficeSessionsState> = {
    subscribe(cb) {
      const un1 = sessions.list.subscribe(cb)
      const un2 = uiSession?.pendingInteractions.subscribe(cb)
      return () => { un1(); un2?.() }
    },
    getSnapshot() {
      const rawState = sessions.list.getSnapshot()
      const rawMap = pendingMap()
      if (listCache !== undefined && listCache.rawState === rawState && listCache.rawMap === rawMap) {
        return listCache.merged
      }
      let byId = rawState.byId
      if (rawMap !== undefined) {
        for (const [id, p] of rawMap) {
          const s: OfficeSessionSummary | undefined = rawState.byId[id]
          if (s === undefined) continue
          const kind = pendingStatusOf(p)
          if (s.pendingInteraction === kind) continue
          if (byId === rawState.byId) byId = { ...rawState.byId }
          byId[id] = { ...s, pendingInteraction: kind }
        }
      }
      const merged = byId === rawState.byId ? rawState : { ...rawState, byId }
      listCache = { rawState, rawMap, merged }
      return merged
    },
  }

  // ---- 单会话：生命周期 + chat legacy + pending 合成 OfficeConversationSnapshot ----
  const composites = new Map<string, { face: RawSessionFace; composite: SessionFace }>()

  const makeComposite = (id: string, face: RawSessionFace): SessionFace => {
    let target: Observable<ChatSnapshotFace | undefined> | undefined
    try {
      target = uiConversation?.binding(id).target('chat')
    } catch {
      target = undefined
    }
    let cache: {
      life: ReturnType<RawSessionFace['getSnapshot']>
      chat: unknown
      pending: PendingInteractionFace | undefined
      snap: OfficeConversationSnapshot
    } | undefined

    return {
      subscribe(cb) {
        const un1 = face.subscribe(cb)
        const un2 = target?.subscribe(cb)
        const un3 = uiSession?.pendingInteractions.subscribe(cb)
        return () => { un1(); un2?.(); un3?.() }
      },
      getSnapshot() {
        const life = face.getSnapshot()
        const chat = target?.getSnapshot()
        const pending = pendingMap()?.get(id)
        if (cache !== undefined && cache.life === life && cache.chat === chat && cache.pending === pending) {
          return cache.snap
        }
        const legacy = chat?.legacy
        const snap: OfficeConversationSnapshot = {
          sessionId: id,
          running: life.running,
          blank: life.blank,
          openState: life.openState,
          nodes: legacy?.nodes ?? EMPTY_NODES,
          runningCalls: legacy?.runningCalls ?? EMPTY_CALLS,
          partial: legacy?.partial ?? null,
          pending: pending !== undefined ? [toPendingWait(pending)] : EMPTY_PENDING,
        }
        cache = { life, chat, pending, snap }
        return snap
      },
      open: () => face.open(),
      prompt: (content, mode) => face.prompt(content, mode),
    }
  }

  const compositeOf = (id: string): SessionFace | undefined => {
    const scoped = scopeRaw(id)
    const face = scoped === undefined ? undefined : sessions.sessionOf(scoped)
    if (face === undefined) return undefined
    const hit = composites.get(id)
    if (hit !== undefined && hit.face === face) return hit.composite
    const composite = makeComposite(id, face)
    composites.set(id, { face, composite })
    return composite
  }

  return {
    list,
    scope: scopeRaw,
    sessionOf(scoped) {
      const id = scoped !== null && (typeof scoped === 'object' || typeof scoped === 'function')
        ? scopeIds.get(scoped as object)
        : undefined
      return id === undefined ? undefined : compositeOf(id)
    },
    open: id => sessions.open(id),
  }
}
