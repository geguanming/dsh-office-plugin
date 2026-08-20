import type { EmployeeInfo, EmployeeStatus } from './pixi/employee.ts'
import { hashString, lookFor } from './pixi/palette.ts'
import { getCustomName, OWNER_DEFAULT_NAME, OWNER_KEY } from './names.ts'

export { OWNER_KEY, OWNER_DEFAULT_NAME }
import type {
  AssistantBlock, OfficeConversationSnapshot, OfficeNode, OfficeSessionSummary, OfficeSessionsState,
  PartialAssistant, RunningToolCall,
} from './runtimeTypes.ts'

/** 办公室牛马总数上限（含总监 1 名）：1 名总监 + 16 名打工牛马 = 17；老板本尊不在此列 */
export const MAX_EMPLOYEES = 17

function mapStatus(s: OfficeSessionSummary): EmployeeStatus {
  return s.running ? 'working' : 'idle'
}

/**
 * 办公室名单：老板 = 当前会话；员工 = 其余全部会话（含别的树的子 agent），
 * 按 搬砖 > 摸鱼 优先，最多 MAX_EMPLOYEES 人。
 */
export function officeStaff(state: OfficeSessionsState, bossId: string | undefined): OfficeSessionSummary[] {
  const boss = bossId !== undefined ? state.byId[bossId] : undefined
  const others: OfficeSessionSummary[] = []
  for (const id of state.ids) {
    const s = state.byId[id]
    if (s !== undefined && s.id !== bossId) others.push(s)
  }
  const budget = Math.max(0, MAX_EMPLOYEES - (boss !== undefined ? 1 : 0))
  const staff = others.length > budget
    ? [...others].sort((a, b) => priority(b) - priority(a) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, budget)
    : others
  return boss !== undefined ? [boss, ...staff] : staff
}

/** 排队中的任务数：超出办公室容量的搬砖会话（等前面员工完成后补位） */
export function queuedCount(state: OfficeSessionsState, bossId: string | undefined): number {
  const boss = bossId !== undefined ? state.byId[bossId] : undefined
  const budget = Math.max(0, MAX_EMPLOYEES - (boss !== undefined ? 1 : 0))
  let active = 0
  for (const id of state.ids) {
    const s = state.byId[id]
    if (s === undefined || s.id === bossId) continue
    if (s.running) active++
  }
  return Math.max(0, active - budget)
}

/** 老板（当前会话）的实时活动：流式文本 > 思考 > 进行中工具 > 最近汇报 > 打字占位 */
function bossDetail(
  partial: PartialAssistant | null,
  calls: readonly RunningToolCall[],
  nodes: readonly OfficeNode[],
): string | undefined {
  if (partial !== null) {
    const text = blocksText(partial.blocks)
    if (text !== '') return truncate(text, 42)
    if (hasReasoning(partial.blocks)) return '思考中…'
  }
  const name = calls[0]?.name
  if (name !== undefined && name !== '') return `干活：${name}`
  const latest = latestNodeActivity(nodes)
  if (latest !== undefined) return latest
  return partial !== null ? '奋笔疾书中…' : undefined
}

/** 只扫描轨迹尾部，防止多 agent 汇报累积海量节点时全量遍历卡住 */
const LATEST_NODE_SCAN = 40

/** 从轨迹尾部找最近的「汇报」（工具结果）或「发言」（assistant 文本） */
function latestNodeActivity(nodes: readonly OfficeNode[]): string | undefined {
  const start = Math.max(0, nodes.length - LATEST_NODE_SCAN)
  for (let i = nodes.length - 1; i >= start; i--) {
    const node = nodes[i]
    if (isToolResult(node)) {
      const name = node.call?.name
      const head = name !== undefined && name !== '' ? `汇报：${name}` : '汇报完成'
      if (node.isError) return `${head} · 出错了`
      const preview = (node.content ?? []).map(b => b.text ?? '').filter(t => t !== '').join(' ').trim()
      return preview === '' ? head : `${head} · ${truncate(preview, 24)}`
    }
    if (isAssistant(node)) {
      const text = blocksText(node.blocks)
      if (text !== '') return `说：${truncate(text, 36)}`
    }
  }
  return undefined
}

/** 任意会话的当前活动摘要（点击员工信息卡展示其正在负责的工作） */
export function sessionActivity(s: OfficeConversationSnapshot): string | undefined {
  const detail = bossDetail(s.partial, s.runningCalls, s.nodes)
  return detail ?? (s.running ? '搬砖中…' : undefined)
}

/** 工位监控窗口里的一条工作条目 */
export interface WorkLine {
  kind: 'thinking' | 'saying' | 'tool' | 'report'
  text: string
}

/** 最多回看的轨迹节点数（与 bossDetail 扫描尾部保持一致，避免海量节点遍历） */
const WORK_SCAN = 60

/**
 * 把会话快照整理成工位监控窗口的工作流：已落地的思考/发言/工具汇报（按发生顺序）
 * → 当前流式中的思考/发言 → 进行中的工具调用（最新在最后）。
 * 之前只扫 tool-result，导致 assistant 回合落地、partial 清空后思考/输出从窗里消失；
 * subagent 的 started 启动通知压成简短派活记录，避免整屏 UUID。
 */
export function sessionWork(s: OfficeConversationSnapshot): WorkLine[] {
  const lines: WorkLine[] = []
  const start = Math.max(0, s.nodes.length - WORK_SCAN)
  for (let i = start; i < s.nodes.length; i++) {
    const node = s.nodes[i]
    if (isAssistant(node)) {
      const reasoning = node.blocks
        .filter((b): b is Extract<AssistantBlock, { kind: 'reasoning' }> => b.kind === 'reasoning' && b.text.trim() !== '')
        .map(b => b.text.trim())
      if (reasoning.length > 0) lines.push({ kind: 'thinking', text: presentText(reasoning.join(' '), 200) })
      const text = blocksText(node.blocks)
      if (text !== '') lines.push({ kind: 'saying', text: presentText(text, 400) })
    } else if (isToolResult(node) && !node.isError) {
      const name = node.call?.name ?? node.callId
      const preview = (node.content ?? []).map(b => b.text ?? '').filter(t => t !== '').join(' ').trim()
      if (name === 'subagent') {
        const m = preview.match(/started subagent\s+([0-9a-f-]+)/i)
        if (m !== null) {
          lines.push({ kind: 'tool', text: `派活 → 牛马上岗 ${m[1].slice(0, 8)}` })
          continue
        }
      }
      lines.push({ kind: 'report', text: preview === '' ? name : `${name}: ${truncate(preview, 200)}` })
    }
  }
  if (s.partial !== null) {
    const text = blocksText(s.partial.blocks)
    if (text !== '') lines.push({ kind: 'saying', text: presentText(text, 400) })
    else if (hasReasoning(s.partial.blocks)) lines.push({ kind: 'thinking', text: '思考中…' })
  }
  for (const call of s.runningCalls) {
    const args = call.argsRaw.trim()
    lines.push({ kind: 'tool', text: args === '' ? call.name : `${call.name} ${args}` })
  }
  // 连续的「派活 → 牛马上岗 …」折叠成一行（批量派 subagent 时整屏都是它）
  const collapsed: WorkLine[] = []
  for (const line of lines) {
    const prev = collapsed[collapsed.length - 1]
    if (prev !== undefined && line.kind === 'tool' && prev.kind === 'tool'
      && line.text.startsWith('派活 → 牛马上岗') && prev.text.startsWith('派活 → 牛马上岗')) {
      const n = /^派活 → 牛马上岗(?:\s*×(\d+))?$/.exec(prev.text)
      const count = n !== null && n[1] !== undefined ? Number(n[1]) + 1 : 2
      prev.text = `派活 → 牛马上岗 ×${count}`
    } else {
      collapsed.push(line)
    }
  }
  return collapsed.slice(-20)
}

/** 底部协作字幕用的最新一条活动（带类型，供 DOM 层区分图标） */
export interface BossFeedEntry {
  kind: 'stream' | 'tool' | 'monitor' | 'report'
  text: string
}

/**
 * 统计某会话直属的、正在运行的子代理数。sessions list 里的 running 标志对后台
 * one-shot 子代理可能滞后，subagent catalog（subagentsByParent）的 activity 更准，
 * 两者按 id 合并去重。
 */
export function runningChildrenCount(state: OfficeSessionsState, parentId: string | undefined): number {
  if (parentId === undefined) return 0
  const running = new Set<string>()
  for (const id of state.ids) {
    const s = state.byId[id]
    if (s !== undefined && s.parentId === parentId && s.running) running.add(id)
  }
  const catalog = state.subagentsByParent[parentId]
  if (catalog !== undefined) {
    for (const e of catalog.entries) {
      if (e.kind === 'child' && e.activity === 'running') running.add(e.id)
    }
  }
  return running.size
}

/**
 * 老板字幕：流式输出 > 进行中工具 > 监工（有直属子代理在跑）> 轨迹尾部最近汇报/发言。
 * 后台 subagent 启动即返回，轨迹尾部会堆一串 started 汇报；监工位优先于它们，
 * 让等待期显示「N 头牛马搬砖中」而不是重复的工具名。
 */
export function bossFeed(
  activity: {
    partial: PartialAssistant | null
    calls: readonly RunningToolCall[]
    nodes: readonly OfficeNode[]
  },
  runningChildren = 0,
): BossFeedEntry | undefined {
  const { partial, calls, nodes } = activity
  if (partial !== null) {
    const text = blocksText(partial.blocks)
    if (text !== '') return { kind: 'stream', text: truncate(text, 64) }
    if (hasReasoning(partial.blocks)) return { kind: 'stream', text: '思考中…' }
  }
  const name = calls[0]?.name
  if (name !== undefined && name !== '') return { kind: 'tool', text: `干活：${name}` }
  if (runningChildren > 0) {
    return { kind: 'monitor', text: `监工中：${runningChildren} 头牛马搬砖…` }
  }
  const start = Math.max(0, nodes.length - LATEST_NODE_SCAN)
  for (let i = nodes.length - 1; i >= start; i--) {
    const node = nodes[i]
    if (isToolResult(node)) {
      const preview = (node.content ?? []).map(b => b.text ?? '').filter(t => t !== '').join(' ').trim()
      // subagent 启动通知是派活中间态，不是真汇报；catalog 未就绪时也别刷 UUID
      if (node.call?.name === 'subagent' && /^subagent:\s*started/i.test(preview)) {
        return { kind: 'monitor', text: '派活中…' }
      }
      if (preview !== '') return { kind: 'report', text: truncate(preview, 56) }
      return { kind: 'report', text: `汇报：${node.call?.name ?? node.callId}` }
    }
    if (isAssistant(node)) {
      const text = blocksText(node.blocks)
      if (text !== '') return { kind: 'stream', text: truncate(text, 64) }
    }
  }
  return partial !== null ? { kind: 'stream', text: '奋笔疾书中…' } : undefined
}

function isToolResult(node: OfficeNode | undefined): node is Extract<OfficeNode, { kind: 'tool-result' }> {
  return node?.kind === 'tool-result'
}

function isAssistant(node: OfficeNode | undefined): node is Extract<OfficeNode, { kind: 'assistant' }> {
  return node?.kind === 'assistant'
}

function blocksText(blocks: readonly AssistantBlock[] | undefined): string {
  if (blocks === undefined) return ''
  return blocks
    .filter((b): b is Extract<AssistantBlock, { kind: 'text' }> => b.kind === 'text' && b.text !== '')
    .map(b => b.text)
    .join(' ')
    .trim()
}

function hasReasoning(blocks: readonly AssistantBlock[] | undefined): boolean {
  if (blocks === undefined) return false
  return blocks.some((b): b is Extract<AssistantBlock, { kind: 'reasoning' }> => b.kind === 'reasoning')
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 把模型输出整理成监控窗可读的纯文本：
 * - ```dsh-ui 卡片块是给宿主 UI 渲染的 JSON，监控窗里压成标题摘要，不整段 dump；
 * - 折叠多余空行；最后截断。
 */
export function presentText(text: string, max: number): string {
  const collapsed = text
    .replace(/```dsh-ui\s*([\s\S]*?)```/gi, (_m, json: string) => summarizeDshUi(json))
    .replace(/```dsh-ui[\s\S]*$/gi, '📊 工作卡片…')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return truncate(collapsed, max)
}

/** 从 dsh-ui 卡片 JSON 里取一个可读标题（callout.title / 首个 badge.label / 条目类型计数） */
function summarizeDshUi(json: string): string {
  try {
    const root = JSON.parse(json) as unknown
    const titles: string[] = []
    collectTitles(root, titles)
    if (titles.length > 0) return `📊 ${titles.slice(0, 3).join(' · ')}`
  } catch {
    // JSON 不完整（流式中）时静默回退
  }
  return '📊 工作卡片'
}

function collectTitles(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTitles(item, out)
    return
  }
  if (node === null || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if (typeof obj.title === 'string' && obj.title.trim() !== '') out.push(obj.title.trim())
  if (typeof obj.label === 'string' && obj.label.trim() !== '' && out.length < 6) out.push(obj.label.trim())
  for (const key of ['items', 'rows', 'columns']) {
    const child = obj[key]
    if (Array.isArray(child)) for (const item of child) collectTitles(item, out)
  }
}

/**
 * 会话列表 -> 员工清单。老板 = 当前会话（实时活动经 partial/calls/nodes 派生），
 * 其余会话都是打工牛马。
 */
export function toEmployees(
  state: OfficeSessionsState,
  currentSessionId: string | undefined,
  currentCalls: readonly RunningToolCall[],
  currentPartial: PartialAssistant | null,
  currentNodes: readonly OfficeNode[],
): EmployeeInfo[] {
  const currentDetailText = currentSessionId === undefined
    ? undefined
    : bossDetail(currentPartial, currentCalls, currentNodes)

  return officeStaff(state, currentSessionId).map(s => {
    const running = s.running === true
    return {
      id: s.id,
      label: s.displayTitle?.trim() !== '' && s.displayTitle !== undefined ? s.displayTitle : s.id.slice(0, 8),
      root: s.id === currentSessionId,
      status: mapStatus(s),
      detail: running ? (s.id === currentSessionId ? currentDetailText : '搬砖中…') : undefined,
      pending: s.pendingInteraction !== undefined,
    }
  })
}

function priority(s: OfficeSessionSummary): number {
  return s.running ? 1 : 0
}

export interface OfficeStats {
  working: number
  idle: number
  total: number
}

/** 状态统计（顶部看板用，与办公室同一份名单） */
export function statsOf(state: OfficeSessionsState, currentSessionId: string | undefined): OfficeStats {
  const stats: OfficeStats = { working: 0, idle: 0, total: 0 }
  for (const s of officeStaff(state, currentSessionId)) {
    stats.total++
    if (mapStatus(s) === 'working') stats.working++
    else stats.idle++
  }
  return stats
}

export function statusLabel(s: OfficeSessionSummary): string {
  return mapStatus(s) === 'working' ? '搬砖中' : '摸鱼中'
}

const CN_SEQ = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']

/** 员工名牌：自定义名优先；否则由 session id 稳定决定物种与编号（不读对话内容，刷新后不变） */
export function employeeName(id: string): string {
  const custom = getCustomName(id)
  if (custom !== undefined) return custom
  const n = (hashString(id) >>> 6) % 20
  return `${speciesOf(id)}小${CN_SEQ[n]}`
}

/** 员工物种中文名 */
export function speciesOf(id: string): '牛' | '马' {
  return lookFor(id).species === 'ox' ? '牛' : '马'
}

/** 员工状态颜色（信息卡用，与顶部看板配色一致） */
export function statusColor(s: OfficeSessionSummary): string {
  return mapStatus(s) === 'working' ? '#D9714E' : '#5B87C4'
}
