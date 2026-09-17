import { createElement } from 'react'
import { OfficeLauncher } from './OfficeLauncher.tsx'
import { adaptRuntime } from './runtimeAdapter.ts'
import type { SessionsServiceFace, UiConversationFace, UiSessionFace } from './runtimeTypes.ts'

/** 浏览器侧 slots 服务的最小类型面（运行时由 @deepseek-ai/dsh-client-ui-slots 提供）。 */
interface SlotRegisterOptions {
  name: string
  id: string
  order?: number
  label?: () => string
}

interface SlotsService {
  inject(key: string, register: () => void): void
  register(options: SlotRegisterOptions, component: unknown): void
}

interface ClientContext {
  slots: SlotsService
  /** ui-layout 提供，用于收起/恢复左侧会话栏 */
  layout?: { toggleSidebar(): void }
  /** 会话服务：0.1.5 起只含列表与生命周期，会话内容/待办见下两个服务 */
  sessions?: SessionsServiceFace
  /** 0.1.5 新增：会话内容快照（binding(id).target('chat').legacy） */
  uiConversation?: UiConversationFace
  /** 0.1.5 新增：待审批/提问（pendingInteractions） */
  uiSession?: UiSessionFace
}

/** 需要的浏览器服务：slots 注册入口；layout 收起/恢复左侧栏；后三个经 runtimeAdapter 拼回 0.1.2 的会话数据形状。 */
export const inject = ['slots', 'layout', 'sessions', 'uiConversation', 'uiSession']

/**
 * 客户端插件主体：在窗口右上角（shell.overlay 全局层）注册「实景办公室」入口，
 * 空白新会话也能看到。点击展开右侧侧边栏面板查看多智能体办公室；对话保持在中栏。
 */
export function apply(ctx: ClientContext): void {
  // 适配只做一次：内部缓存（合成快照的记忆化）依赖单例
  const officeCtx = {
    layout: ctx.layout,
    sessions: ctx.sessions === undefined
      ? undefined
      : adaptRuntime({ sessions: ctx.sessions, uiConversation: ctx.uiConversation, uiSession: ctx.uiSession }),
  }
  ctx.slots.inject('shell.overlay', () => {
    ctx.slots.register({
      name: 'shell.overlay',
      id: 'office',
      order: 50,
    }, () => createElement(OfficeLauncher, { ctx: officeCtx }))
  })
}
