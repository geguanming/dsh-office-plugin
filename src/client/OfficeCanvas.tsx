import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Application } from 'pixi.js'
import { createOfficeScene } from './pixi/officeScene.ts'
import {
  bossFeed, employeeName, officeStaff, queuedCount, runningChildrenCount, sessionActivity, sessionWork,
  speciesOf, statusColor, statusLabel, statsOf, toEmployees, type BossFeedEntry, type WorkLine,
} from './officeStore.ts'
import { namesVersion, ownerName, setCustomName, subscribeNames, OWNER_KEY } from './names.ts'
import type {
  OfficeConversationSnapshot, OfficeNode, OfficeSessionsState, PartialAssistant,
  PendingInteractionStatus, PendingWaitFace, RunningToolCall, SnapshotSelectorHook,
} from './runtimeTypes.ts'

/** ctx.sessions 的最小面（用于订阅会话列表与任意会话的实时快照） */
export interface SessionsFace {
  list: { subscribe(cb: () => void): () => void; getSnapshot(): OfficeSessionsState }
  scope(id: string): unknown | undefined
  sessionOf(scoped: unknown): SessionFace | undefined
  /** 把主对话切到该会话（原生面板回答提问/计划评审用） */
  open(id: string): void
}

export interface SessionFace {
  subscribe(cb: () => void): () => void
  getSnapshot(): OfficeConversationSnapshot
  /**
   * 后台打开该会话的历史窗口：拉取尾页历史并开始接收实时帧。
   * 不改变当前会话（不切主视图）；幂等——已打开立即返回，加载中复用同一
   * promise，失败后下次调用自动重试。运行时具体 Session 类公开此方法。
   */
  open(): Promise<void>
  /**
   * 发送用户消息（与对话输入框同通道，mode 'queue' 排队不打断）。
   * 失败不 reject：返回 { ok: false, error }，并镜像进快照的 promptError。
   */
  prompt(
    content: Array<{ type: 'text'; text: string }>,
    mode: 'queue' | 'steer',
  ): Promise<{ ok: true; value: { accepted: true } } | { ok: false; error: { code: string; message?: string } }>
}

/** 办公室画布组件收到的标准 props 子集（useSession 收到真实 ConversationSnapshot）。 */
export interface OfficeCanvasProps {
  sessionId: string
  useSessions: SnapshotSelectorHook<OfficeSessionsState>
  useSession: SnapshotSelectorHook<OfficeConversationSnapshot>
  /** ctx.sessions，点击员工时订阅其所在会话的实时活动 */
  sessions?: SessionsFace
}

interface CurrentActivity {
  calls: readonly RunningToolCall[]
  partial: PartialAssistant | null
  nodes: readonly OfficeNode[]
}

/** 订阅被点击员工的会话实时快照（用于信息卡展示其正在负责的工作） */
function useSelectedSnapshot(
  id: string | undefined,
  sessions: SessionsFace | undefined,
): OfficeConversationSnapshot | undefined {
  const subscribe = useCallback((cb: () => void) => {
    if (id === undefined || sessions === undefined) return () => {}
    const scoped = sessions.scope(id)
    const face = scoped === undefined ? undefined : sessions.sessionOf(scoped)
    return face === undefined ? () => {} : face.subscribe(cb)
  }, [id, sessions])
  const getSnapshot = useCallback(() => {
    if (id === undefined || sessions === undefined) return undefined
    const scoped = sessions.scope(id)
    const face = scoped === undefined ? undefined : sessions.sessionOf(scoped)
    return face === undefined ? undefined : face.getSnapshot()
  }, [id, sessions])
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function OfficeCanvas(props: OfficeCanvasProps): React.ReactElement {
  // 订阅自定义名版本：改名后让信息卡/监控窗/老板名牌重渲染
  useSyncExternalStore(subscribeNames, namesVersion)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [screenId, setScreenId] = useState<string | undefined>(undefined)
  // 自动拍板弹窗被 ✕ 关掉的会话：该会话 pending 消失后复位，新待办会再弹
  const [dismissedId, setDismissedId] = useState<string | undefined>(undefined)
  // 老板迷你输入条：点老板弹出，发送走当前会话（总监）的 prompt 通道
  const [ownerCompose, setOwnerCompose] = useState(false)
  const [ownerDraft, setOwnerDraft] = useState('')
  const [ownerError, setOwnerError] = useState<string | undefined>(undefined)
  const sceneRef = useRef<{ destroy(): void; bossOrders(): void } | undefined>(undefined)

  // 点击员工屏幕：后台冷会话的窗口从未打开，运行时会丢弃其实时帧
  // （acceptLiveEvent 在 openState!=='open' 时直接 return），导致监控窗
  // 只有 running 位而无内容。直接通过 binding/sessionOf 拿到该会话对象并
  // 调 open()，在后台拉取历史窗口、开始接收实时帧——不切换当前会话、不跳
  // 主视图。open() 幂等：已打开立即返回，加载中复用 promise，失败后下次点
  // 击自动重试，因此不需要预热去重。
  const openScreen = useCallback((id: string): void => {
    setScreenId(id)
    const sessions = props.sessions
    if (sessions === undefined) return
    const scoped = sessions.scope(id)
    if (scoped === undefined) return
    const face = sessions.sessionOf(scoped)
    if (face === undefined) return
    void face.open().catch(() => { /* 失败静默：下次点击自动重试 */ })
  }, [props.sessions])

  // 老板发号施令：与对话输入框同通道（prompt 'queue'），失败保留草稿并内联红字
  const sendOwnerOrder = useCallback((): void => {
    const text = ownerDraft.trim()
    if (text === '') return
    const sessions = props.sessions
    const id = props.sessionId
    if (sessions === undefined) {
      setOwnerError('会话服务不可用')
      return
    }
    const scoped = sessions.scope(id)
    const face = scoped === undefined ? undefined : sessions.sessionOf(scoped)
    if (face === undefined) {
      setOwnerError('找不到当前会话，发送失败')
      return
    }
    setOwnerError(undefined)
    void face.prompt([{ type: 'text', text }], 'queue').then(result => {
      if (result.ok) {
        setOwnerDraft('')
        setOwnerCompose(false)
        sceneRef.current?.bossOrders()
      } else {
        setOwnerError(result.error.message ?? result.error.code)
      }
    }).catch(() => setOwnerError('发送失败，请重试'))
  }, [ownerDraft, props.sessions, props.sessionId])

  // 场景在 effect 里轮询数据，快照经 ref 传入（订阅本身在渲染期完成）
  const sessions = props.useSessions(s => s)
  const activity = props.useSession(s => ({
    calls: s.runningCalls,
    partial: s.partial,
    nodes: s.nodes,
  }))
  const dataRef = useRef({ sessions, activity, sessionId: props.sessionId })
  dataRef.current = { sessions, activity, sessionId: props.sessionId }
  const stats = statsOf(sessions, props.sessionId)
  const queued = queuedCount(sessions, props.sessionId)
  // 直属子代理中正在跑的数量：底部字幕的监工位用它替代重复的 subagent started 汇报。
  // 合并 sessions list 与 subagent catalog，避免后台 one-shot 子代理漏数。
  const runningChildren = runningChildrenCount(sessions, props.sessionId)
  const feed = bossFeed(activity, runningChildren)
  const selectedSummary = selected !== undefined ? sessions.byId[selected] : undefined
  const selectedSnapshot = useSelectedSnapshot(selected, props.sessions)
  // 自动拍板弹窗的目标：优先总监（当前会话），否则第一头有待办的在场员工；
  // 被关掉（dismissedId）或正在信息卡里展示（selected）时不重复弹
  const autoPendingId = useMemo(() => {
    if (selectedSummary?.pendingInteraction !== undefined) return undefined
    const boss = props.sessionId !== undefined ? sessions.byId[props.sessionId] : undefined
    if (boss?.pendingInteraction !== undefined && props.sessionId !== dismissedId) return props.sessionId
    for (const s of officeStaff(sessions, props.sessionId)) {
      if (s.id !== props.sessionId && s.pendingInteraction !== undefined && s.id !== dismissedId) return s.id
    }
    return undefined
  }, [sessions, props.sessionId, selectedSummary, dismissedId])
  const pendingSnapshot = useSelectedSnapshot(autoPendingId, props.sessions)
  useEffect(() => {
    if (dismissedId === undefined) return
    if (sessions.byId[dismissedId]?.pendingInteraction === undefined) setDismissedId(undefined)
  }, [sessions, dismissedId])
  // 有 pending 的会话需要后台 open() 重放 manager 缓冲区的待审批帧，
  // snapshot.pending 才会出现（冷会话的审批帧被缓冲，不进未打开会话的快照）。
  const focusPending: { id: string; kind: PendingInteractionStatus; snapshot: OfficeConversationSnapshot | undefined } | undefined
    = selectedSummary?.pendingInteraction !== undefined && selected !== undefined
      ? { id: selected, kind: selectedSummary.pendingInteraction, snapshot: selectedSnapshot }
      : autoPendingId !== undefined
        ? { id: autoPendingId, kind: sessions.byId[autoPendingId]?.pendingInteraction ?? 'question', snapshot: pendingSnapshot }
        : undefined
  useEffect(() => {
    const target = focusPending
    if (target === undefined) return
    const faceProps = props.sessions
    if (faceProps === undefined) return
    const scoped = faceProps.scope(target.id)
    if (scoped === undefined) return
    const face = faceProps.sessionOf(scoped)
    if (face === undefined) return
    if (target.kind === 'approval' && target.snapshot?.pending?.some(p => p.kind === 'approval')) return
    void face.open().catch(error => { console.error('[dsh-office] 打开待审批会话失败:', error) })
  }, [focusPending?.id, focusPending?.kind, focusPending?.snapshot?.pending, props.sessions])
  const screenSummary = screenId !== undefined ? sessions.byId[screenId] : undefined
  const screenSnapshot = useSelectedSnapshot(screenId, props.sessions)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const app = new Application()
    let disposed = false
    let scene: { destroy(): void; bossOrders(): void } | undefined
    let observer: ResizeObserver | undefined

    void app.init({ antialias: true, background: '#E8DCC8' }).then(() => {
      if (disposed) return
      host.appendChild(app.canvas)
      scene = createOfficeScene(app, {
        list() {
          const d = dataRef.current
          return toEmployees(d.sessions, d.sessionId, d.activity.calls, d.activity.partial, d.activity.nodes)
        },
      }, {
        onSelect: setSelected,
        onSelectScreen: openScreen,
        onOwnerTap: () => setOwnerCompose(true),
      })
      sceneRef.current = scene
      // 手动跟随宿主尺寸：面板宽度变化时画布可靠 resize（比内置 resizeTo 更稳）
      const resize = (): void => { app.renderer.resize(host.clientWidth, host.clientHeight) }
      resize()
      observer = new ResizeObserver(resize)
      observer.observe(host)
    })

    return () => {
      disposed = true
      observer?.disconnect()
      sceneRef.current = undefined
      scene?.destroy()
      try {
        app.destroy(true, { children: true, texture: true })
      } catch {
        // init 未完成即卸载时 destroy 会抛错，忽略即可
      }
    }
  }, [])

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%', minHeight: 320, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 10, left: 12, display: 'flex', gap: 6, zIndex: 10, pointerEvents: 'none' }}>
        <Stat chip="🐑牛马总数" value={stats.total} color="#8A7A63" />
        <Stat chip="🔥搬砖中" value={stats.working} color="#D9714E" />
        <Stat chip="☕摸鱼中" value={stats.idle} color="#5B87C4" />
        {queued > 0 && <Stat chip="🚶排队中" value={queued} color="#A08A5F" />}
      </div>
      {feed !== undefined && (
        <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'rgba(255,255,255,0.92)', borderRadius: 999, padding: '4px 16px', fontSize: 13, color: '#6E6252', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', fontWeight: 600, maxWidth: '72%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15 }}>{FEED_ICON[feed.kind]}</span>
          <span>{feed.text}</span>
        </div>
      )}
      {ownerCompose && (
        <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 12, background: '#FFFFFF', borderRadius: 12, padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,0.18)', fontSize: 13, color: '#4A4034', width: 300 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>👑</span>
            <span style={{ fontWeight: 700, flex: 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <EditableName storageKey={OWNER_KEY} size={14} />
              <span style={{ color: '#8A7A63', fontWeight: 500, fontSize: 12 }}>发号施令</span>
            </span>
            <button onClick={() => setOwnerCompose(false)} title="收起" aria-label="收起" style={{ border: 'none', background: 'transparent', color: '#8A7A63', cursor: 'pointer', width: 22, height: 22, borderRadius: 6, fontSize: 13, lineHeight: 1 }}>✕</button>
          </div>
          {ownerError !== undefined && (
            <div style={{ color: '#C0492F', fontSize: 12, marginBottom: 6 }}>发送失败：{ownerError}</div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={ownerDraft}
              onChange={e => setOwnerDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') sendOwnerOrder()
                else if (e.key === 'Escape') setOwnerCompose(false)
              }}
              placeholder="给总监下一道指令…"
              style={{ flex: 1, border: '1px solid #E0D6C2', borderRadius: 8, padding: '6px 10px', fontSize: 13, outline: 'none', color: '#4A4034', background: '#FFFFFF', caretColor: '#4A4034' }}
            />
            <button onClick={sendOwnerOrder} style={{ border: 'none', borderRadius: 8, padding: '6px 14px', background: '#5B9E7D', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>发送</button>
          </div>
        </div>
      )}
      {selectedSummary !== undefined && (
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, background: '#FFFFFF', borderRadius: 12, padding: '12px 14px', boxShadow: '0 6px 20px rgba(0,0,0,0.16)', fontSize: 13, color: '#4A4034', minWidth: 216 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 30, lineHeight: 1 }}>{speciesOf(selectedSummary.id) === '牛' ? '🐮' : '🐴'}</span>
            <div style={{ minWidth: 0 }}>
              <EditableName storageKey={selectedSummary.id} size={15} />
              <div style={{ fontSize: 11, color: '#8A7A63', fontFamily: 'monospace' }}>{selectedSummary.id.slice(0, 16)}</div>
            </div>
            <button onClick={() => setSelected(undefined)} title="关闭" aria-label="关闭" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#8A7A63', cursor: 'pointer', width: 24, height: 24, borderRadius: 6, fontSize: 13, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 12px', marginTop: 10, paddingTop: 10, borderTop: '1px solid #F0EAE0', color: '#6E6252' }}>
            <span style={{ color: '#9A8A72' }}>物种</span><span>{speciesOf(selectedSummary.id)}</span>
            <span style={{ color: '#9A8A72' }}>状态</span><span style={{ fontWeight: 600, color: statusColor(selectedSummary) }}>{statusLabel(selectedSummary)}</span>
            <span style={{ color: '#9A8A72' }}>职位</span><span>{selectedSummary.parentId === undefined ? '总监牛马' : '打工牛马'}</span>
            {selectedSnapshot !== undefined && (
              <>
                <span style={{ color: '#9A8A72' }}>当前</span>
                <span style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionActivity(selectedSnapshot) ?? '摸鱼中'}</span>
              </>
            )}
          </div>
          {selectedSummary.pendingInteraction !== undefined && (
            <PendingCard
              kind={selectedSummary.pendingInteraction}
              snapshot={selectedSnapshot}
              onGoThere={() => props.sessions?.open(selectedSummary.id)}
            />
          )}
        </div>
      )}
      {autoPendingId !== undefined && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 11, background: '#FFFFFF', borderRadius: 12, padding: '12px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', fontSize: 13, color: '#4A4034', minWidth: 240, maxWidth: 320 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22 }}>{speciesOf(autoPendingId) === '牛' ? '🐮' : '🐴'}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{employeeName(autoPendingId)}{autoPendingId === props.sessionId ? '（总监）' : ''}</div>
              <div style={{ fontSize: 11, color: '#B56A2A' }}>有事找老板，等你拍板</div>
            </div>
            <button onClick={() => setDismissedId(autoPendingId)} title="稍后处理" aria-label="稍后处理" style={{ border: 'none', background: 'transparent', color: '#8A7A63', cursor: 'pointer', width: 24, height: 24, borderRadius: 6, fontSize: 13, lineHeight: 1 }}>✕</button>
          </div>
          <PendingCard
            kind={sessions.byId[autoPendingId]?.pendingInteraction ?? 'approval'}
            snapshot={pendingSnapshot}
            onGoThere={() => props.sessions?.open(autoPendingId)}
          />
        </div>
      )}
      {screenSummary !== undefined && (
        <WorkMonitor
          id={screenSummary.id}
          parentId={screenSummary.parentId}
          snapshot={screenSnapshot}
          onClose={() => setScreenId(undefined)}
        />
      )}
    </div>
  )
}

type ApprovalOutcome = 'allowed-once' | 'rejected'

/**
 * 现场审批拍板卡：approval 就地显示工具名/原因 + 批准/拒绝按钮；
 * question/plan-review 只给「去处理」跳原生面板（结构化答案不在此卡片内回答）。
 * 按钮在 respond 发出后本地禁用，待 approval/resolved 帧移除 pending（帧驱动）。
 */
function PendingCard({
  kind, snapshot, onGoThere,
}: {
  kind: 'approval' | 'plan-review' | 'question'
  snapshot: OfficeConversationSnapshot | undefined
  onGoThere: () => void
}): React.ReactElement {
  const [answered, setAnswered] = useState<{ key: string; outcome: ApprovalOutcome } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)

  if (kind === 'question' || kind === 'plan-review') {
    return (
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #F0EAE0' }}>
        <div style={{ color: '#B56A2A', fontWeight: 700, fontSize: 12.5 }}>
          {kind === 'plan-review' ? '📋 有计划等你评审' : '🙋 有问题等你回答'}
        </div>
        <button
          onClick={onGoThere}
          style={{ marginTop: 8, width: '100%', border: 'none', borderRadius: 8, padding: '7px 0', background: '#5B87C4', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
        >去处理</button>
      </div>
    )
  }

  const approval = pendingListFind(snapshot)
  const payload = approval?.payload
  const toolName = payload?.toolName
  const reason = payload?.reason
  // busy 完全由「当前这条审批 === 我已答复的那条」派生：resolved 帧移除 pending、
  // 切换员工或新审批（key 变化）时自动复位，换人不会继承上一个人的禁用态
  const busy = answered !== null && approval !== undefined && answered.key === approval.key
  const error = failure !== null && failure.key === approval?.key ? failure.message : null

  const answer = (outcome: ApprovalOutcome): void => {
    if (approval === undefined || busy) return
    if (payload?.approvalId === undefined) {
      setFailure({ key: approval.key, message: '审批内容不完整（缺 approvalId），请到原生面板处理' })
      return
    }
    setAnswered({ key: approval.key, outcome })
    setFailure(null)
    const value = { sessionId: approval.sessionId, approvalId: payload.approvalId, outcome }
    Promise.resolve(approval.respond({ ok: true, value })).then(receipt => {
      const r = receipt as { accepted?: boolean } | undefined
      if (r?.accepted === false) {
        setFailure({ key: approval.key, message: '未被采纳，可能已被别处处理' })
        setAnswered(null)
      }
      // accepted:true：等 resolved 帧移除 pending 后 busy 随派生自动复位
    }).catch(err => {
      setFailure({ key: approval.key, message: err instanceof Error ? err.message : '回应失败' })
      setAnswered(null)
    })
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #F0EAE0' }}>
      <div style={{ color: '#B56A2A', fontWeight: 700, fontSize: 12.5 }}>🙋 等你拍板</div>
      {approval === undefined
        ? <div style={{ marginTop: 6, fontSize: 12, color: '#A99B82' }}>正在调取审批内容…</div>
        : (
          <>
            {toolName !== undefined && toolName !== '' && (
              <div style={{ marginTop: 5, fontSize: 12.5, color: '#4A4034' }}>
                工具：<code style={{ background: '#EFE7D6', borderRadius: 3, padding: '0 4px', color: '#8A5A2B' }}>{toolName}</code>
              </div>
            )}
            {reason !== undefined && reason !== '' && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#6E6252', lineHeight: 1.5, maxHeight: 64, overflowY: 'auto' }}>{reason}</div>
            )}
            {error !== null && <div style={{ marginTop: 6, fontSize: 12, color: '#C0492F' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
              <button
                onClick={() => answer('allowed-once')}
                disabled={busy}
                style={{ flex: 1, border: 'none', borderRadius: 8, padding: '7px 0', background: !busy ? '#5B9E7D' : '#B9CDBF', color: '#fff', fontWeight: 700, cursor: !busy ? 'pointer' : 'default', fontSize: 13 }}
              >{busy && answered !== null && answered.outcome === 'allowed-once' ? '已批准…' : '批准'}</button>
              <button
                onClick={() => answer('rejected')}
                disabled={busy}
                style={{ flex: 1, border: 'none', borderRadius: 8, padding: '7px 0', background: !busy ? '#C06A4E' : '#D5B3A8', color: '#fff', fontWeight: 700, cursor: !busy ? 'pointer' : 'default', fontSize: 13 }}
              >{busy && answered !== null && answered.outcome === 'rejected' ? '已拒绝…' : '拒绝'}</button>
            </div>
          </>
        )}
    </div>
  )
}

function pendingListFind(snapshot: OfficeConversationSnapshot | undefined): PendingWaitFace | undefined {
  return snapshot?.pending?.find(p => p.kind === 'approval')
}

const WORK_META: Record<WorkLine['kind'], { icon: string; label: string; color: string }> = {
  thinking: { icon: '💭', label: '思考', color: '#8A7A9E' },
  saying: { icon: '💬', label: '输出', color: '#4A7AA8' },
  tool: { icon: '🔧', label: '工具', color: '#D9714E' },
  report: { icon: '📥', label: '汇报', color: '#5B9E7D' },
}

function WorkMonitor({
  id, parentId, snapshot, onClose,
}: {
  id: string
  parentId: string | undefined
  snapshot: OfficeConversationSnapshot | undefined
  onClose: () => void
}): React.ReactElement {
  const lines = useMemo(() => (snapshot !== undefined ? sessionWork(snapshot) : []), [snapshot])
  return (
    <div
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(60,48,30,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#FBF8F1', borderRadius: 14, width: 'min(560px, 94%)', maxHeight: '80%', display: 'flex', flexDirection: 'column', boxShadow: '0 18px 48px rgba(0,0,0,0.28)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #ECE3D2', background: '#F5EEE0' }}>
          <span style={{ fontSize: 22 }}>{speciesOf(id) === '牛' ? '🐮' : '🐴'}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#4A4034' }}>
              {employeeName(id)} 的工位监控
              {snapshot?.running === true && <span style={{ marginLeft: 8, fontSize: 11, color: '#D9714E', fontWeight: 700 }}>● 实时</span>}
            </div>
            <div style={{ fontSize: 11, color: '#9A8A72', fontFamily: 'monospace' }}>{id.slice(0, 24)}{parentId === undefined ? ' · 总监' : ''}</div>
          </div>
          <button onClick={onClose} title="关闭" aria-label="关闭" style={{ border: 'none', background: 'transparent', color: '#8A7A63', cursor: 'pointer', width: 28, height: 28, borderRadius: 6, fontSize: 15, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: '10px 16px', overflowY: 'auto', fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace', fontSize: 12.5, lineHeight: 1.6 }}>
          {lines.length === 0
            ? <div style={{ color: '#A99B82', padding: '18px 0', textAlign: 'center' }}>
              {snapshot?.openState === 'error'
                ? '工作画面拉取失败，关闭后重点屏幕可重试'
                : snapshot?.running || snapshot?.openState === 'loading' || snapshot?.openState === 'cold'
                  ? '正在同步该工位的工作画面…'
                  : '暂无工作记录…'}
            </div>
            : lines.map((line, i) => {
                const meta = WORK_META[line.kind]
                return (
                  <div key={i} style={{ display: 'flex', gap: 9, padding: '5px 0', borderBottom: i < lines.length - 1 ? '1px dashed #EDE5D4' : 'none' }}>
                    <span style={{ flex: 'none', width: 52, color: meta.color, fontWeight: 700 }}><span style={{ marginRight: 4 }}>{meta.icon}</span>{meta.label}</span>
                    <span style={{ color: '#5A4F40', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                      {line.kind === 'saying' || line.kind === 'thinking' ? renderInline(line.text) : line.text}
                    </span>
                  </div>
                )
              })}
        </div>
      </div>
    </div>
  )
}

const FEED_ICON: Record<BossFeedEntry['kind'], string> = { stream: '📝', tool: '🔧', monitor: '👀', report: '📥' }

/**
 * 极简行内 markdown 渲染：只处理 **加粗** 和 `代码`（模型输出里最常见的两种），
 * 其余原样保留。用占位符切分，避免逐 token 生成大量元素。
 */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      parts.push(<strong key={key++} style={{ color: '#3A3128' }}>{tok.slice(2, -2)}</strong>)
    } else {
      parts.push(<code key={key++} style={{ background: '#EFE7D6', borderRadius: 3, padding: '0 4px', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.92em', color: '#8A5A2B' }}>{tok.slice(1, -1)}</code>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function Stat({ chip, value, color }: { chip: string; value: number; color: string }): React.ReactElement {
  return (
    <div style={{ background: 'rgba(255,255,255,0.92)', borderRadius: 999, padding: '3px 12px', fontSize: 12, color, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {chip} {value}
    </div>
  )
}

/**
 * 内联可编辑人名：点名字进入输入态，Enter/失焦保存，Esc 取消；空串保存即恢复默认名。
 */
function EditableName({
  storageKey, size,
}: {
  storageKey: string
  size: number
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const display = storageKey === OWNER_KEY ? ownerName() : employeeName(storageKey)

  useEffect(() => {
    if (editing) {
      setDraft(display)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (): void => {
    setCustomName(storageKey, draft)
    setEditing(false)
  }
  const cancel = (): void => setEditing(false)

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') cancel()
        }}
        placeholder={storageKey === OWNER_KEY ? '老板' : '牛马'}
        maxLength={12}
        style={{
          fontWeight: 700, fontSize: size, color: '#4A4034',
          border: '1px solid #C7B89A', borderRadius: 6, padding: '2px 6px',
          outline: 'none', background: '#FFFEFA', width: '8em', caretColor: '#4A4034',
        }}
      />
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontWeight: 700, fontSize: size, color: '#4A4034' }}>{display}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="改名字"
        aria-label="改名字"
        style={{
          border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
          color: '#9A8A72', display: 'inline-flex', alignItems: 'center', lineHeight: 1,
        }}
      >
        <svg width={Math.max(12, size - 3)} height={Math.max(12, size - 3)} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M3 21h3.75L17.8 9.94a1.5 1.5 0 0 0 0-2.12l-1.62-1.62a1.5 1.5 0 0 0-2.12 0L3 17.25V21z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M14.5 6.5l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  )
}
