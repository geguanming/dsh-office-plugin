import { createElement } from 'react'
import { OfficeLauncher } from './OfficeLauncher.tsx'
import type { SessionsFace } from './OfficeCanvas.tsx'

/** 浏览器侧 slots 服务的最小类型面（运行时由 @deepseek-ai/dsh-client-runtime 提供）。 */
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
  /** 会话服务：点击员工时订阅其所在会话的实时活动 */
  sessions?: SessionsFace
}

/** 需要的浏览器服务：会话头部右上角 utilities 插槽由 ui-conversation 声明；layout 用于收起/恢复左侧栏；sessions 订阅员工实时活动。 */
export const inject = ['slots', 'layout', 'sessions']

/**
 * 客户端插件主体：在窗口右上角（shell.overlay 全局层）注册「实景办公室」入口，
 * 空白新会话也能看到。点击展开右侧侧边栏面板查看多智能体办公室；对话保持在中栏。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => {
    ctx.slots.register({
      name: 'shell.overlay',
      id: 'office',
      order: 50,
    }, () => createElement(OfficeLauncher, { ctx }))
  })
}
