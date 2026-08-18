import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { OfficeDock } from './OfficeDock.tsx'
import type { SessionFace, SessionsFace } from './OfficeCanvas.tsx'
import type { OfficeConversationSnapshot, OfficeSessionsState, SnapshotSelectorHook } from './runtimeTypes.ts'

/** ctx.layout 的最小面（ui-layout 提供，用于收起/恢复左侧会话栏） */
interface LayoutFace {
  toggleSidebar(): void
}

/** 全局右上角入口需要的 ctx 面（layout + sessions） */
export interface OfficeLauncherProps {
  ctx: { layout?: LayoutFace; sessions?: SessionsFace }
}

const EMPTY_LIST_STATE: OfficeSessionsState = { ids: [], byId: {}, current: undefined, subagentsByParent: {} }
const EMPTY_CONVERSATION: OfficeConversationSnapshot = { sessionId: '', running: false, blank: true, openState: 'cold', nodes: [], runningCalls: [], partial: null }
const NOOP = (): void => {}

/** 解析当前会话的 SessionFace（scope/sessionOf 是纯查找，懒 minted，渲染期调用安全） */
function resolveFace(sessions: SessionsFace | undefined, sessionId: string | undefined): SessionFace | undefined {
  if (sessions === undefined || sessionId === undefined) return undefined
  const scoped = sessions.scope(sessionId)
  return scoped === undefined ? undefined : sessions.sessionOf(scoped)
}

/**
 * 全局右上角入口（shell.overlay）：不依赖会话头部，空白新会话也能看到。
 * 点击收起左侧会话栏并展开办公室侧边栏；会话数据经 ctx.sessions 自订阅。
 */
export function OfficeLauncher(props: OfficeLauncherProps): React.ReactElement {
  const { ctx } = props
  const [open, setOpen] = useState(false)
  const sidebarWasOpen = useRef(false)
  const sessions = ctx.sessions

  // 会话列表自订阅（selector hook 面，透传给 OfficeCanvas）
  const useSessions = useMemo<SnapshotSelectorHook<OfficeSessionsState>>(() => {
    const subscribe = (cb: () => void) => sessions?.list.subscribe(cb) ?? NOOP
    const getSnapshot = () => sessions?.list.getSnapshot() ?? EMPTY_LIST_STATE
    return (selector) => {
      const state = useSyncExternalStore(subscribe, getSnapshot)
      return selector(state)
    }
  }, [sessions])

  const sessionId = useSessions(s => s.current)
  const face = useMemo(() => resolveFace(sessions, sessionId), [sessions, sessionId])
  const useSession = useMemo<SnapshotSelectorHook<OfficeConversationSnapshot>>(() => {
    const subscribe = (cb: () => void) => face?.subscribe(cb) ?? NOOP
    const getSnapshot = () => face?.getSnapshot() ?? EMPTY_CONVERSATION
    return (selector) => {
      const snapshot = useSyncExternalStore(subscribe, getSnapshot)
      return selector(snapshot)
    }
  }, [face])

  const openDock = (): void => {
    sidebarWasOpen.current = isSidebarOpen()
    if (sidebarWasOpen.current) ctx.layout?.toggleSidebar()
    setOpen(true)
  }
  const closeDock = (): void => {
    if (sidebarWasOpen.current) ctx.layout?.toggleSidebar()
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={open ? closeDock : openDock}
        aria-pressed={open}
        title="实景办公室"
        aria-label="实景办公室"
        style={{
          position: 'fixed',
          top: 64,
          right: 12,
          zIndex: 2147483000,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: 'none',
          background: open ? 'var(--dsw-alias-interactive-bg-hover, #EFE9DD)' : 'rgba(255,255,255,0.92)',
          color: 'var(--dsw-alias-label-tertiary, #8A7A63)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 17,
          lineHeight: 1,
          boxShadow: '0 2px 10px rgba(0,0,0,0.14)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M3 11l9-7.5L21 11v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20v-9z"
            stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
          />
          <path d="M9 21.5v-7h6v7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      </button>
      {open && sessionId !== undefined && createPortal(
        <OfficeDock
          sessionId={sessionId}
          useSessions={useSessions}
          useSession={useSession}
          sessions={sessions}
          onClose={closeDock}
        />,
        document.body,
      )}
    </>
  )
}

/** 左侧会话栏是否展开：AppFrame 折叠时在 frame 上打 data-sidebar-collapsed 标记 */
function isSidebarOpen(): boolean {
  return document.querySelector('#root [data-sidebar-collapsed]') === null
}
