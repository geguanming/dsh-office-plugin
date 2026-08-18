/**
 * 与 @deepseek-ai/dsh-client-runtime 真实契约结构兼容的本地类型面。
 * 插件是独立 bundle（不链接仓库包，见 pnpm-workspace.yaml），这里按运行时
 * 导出的形状逐字段对齐，保证 useSession / useSessions 的 selector 类型与真实
 * 快照匹配；字段只保留本插件用到的一层，深层用 unknown 兜底。
 */

/** 框架标准 props 里的选择器 hook 形状（ui-slots/src/store.ts 原样）。 */
export type SnapshotSelectorHook<T> = <S>(sel: (s: T) => S, eq?: (a: S, b: S) => boolean) => S

// ---------- ConversationSnapshot 用到的字段 ----------

/** dsh-llm ContentBlock 的宽松子集：插件只读 type/text。 */
export type ContentBlock = { type: string; text?: string }

/** AssistantMessageNode.blocks 的元素（conversation.ts 判别 union）。 */
export type AssistantBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; attachment: unknown }
  | { kind: 'tool-call'; callId: string; name: string; argsRaw: string }
  | { kind: 'other'; block: unknown }

/** 流式中的 assistant 输出（conversation.ts PartialAssistant）。 */
export interface PartialAssistant {
  turn: number
  step: number
  blocks: readonly AssistantBlock[]
}

/** 已落地的工具结果节点（conversation.ts ToolResultNode 的子集）。 */
export interface ToolResultNode {
  kind: 'tool-result'
  seq: number
  time: number
  callId: string
  call: { name: string; argsRaw: string } | null
  callTime: number | null
  content: readonly ContentBlock[]
  isError: boolean
  subCalls: readonly ToolCallBlock[]
}

/** 进行中的工具调用（conversation.ts RunningToolCall）。 */
export interface RunningToolCall {
  callId: string
  name: string
  argsRaw: string
  turn: number
  step: number
  time: number
  callView: unknown
  subCalls: readonly ToolCallBlock[]
}

/** 递归工具调用：进行中或已落地。 */
export type ToolCallBlock = RunningToolCall | ToolResultNode

/** ConversationNode 的宽松子集：插件只判读 assistant/user/tool-result，其余兜底。 */
export type OfficeNode =
  | { kind: 'assistant'; seq: number; turn: number; step: number; blocks: readonly AssistantBlock[] }
  | { kind: 'user'; seq: number; content: readonly ContentBlock[] }
  | ToolResultNode
  | { kind: string; seq: number; [key: string]: unknown }

/**
 * 运行时 PendingWait 的本地结构面：approval/requested 或 question/requested
 * 帧进入会话的待处理队列；respond(result) 回传结果。payload 对 approval
 * 带 approvalId/toolName/callId/reason；question 的字段本插件不读（只跳原生面板）。
 */
export interface PendingWaitFace {
  readonly kind: 'approval' | 'question'
  readonly key: string
  readonly sessionId: string
  readonly payload: {
    approvalId?: string
    toolName?: string
    callId?: string
    reason?: string
    [key: string]: unknown
  }
  respond(result: unknown): Promise<unknown>
}

/** useSession 的 selector 参数：ConversationSnapshot 用到的字段子集。 */
export interface OfficeConversationSnapshot {
  sessionId: string
  running: boolean
  blank: boolean
  /** 窗口生命周期：cold 未打开 / loading 历史拉取中 / open 已打开 / error 拉取失败 */
  openState: 'cold' | 'loading' | 'open' | 'error'
  nodes: readonly OfficeNode[]
  runningCalls: readonly RunningToolCall[]
  partial: PartialAssistant | null
  /** 当前会话待用户处理的交互（仅 open 后才有；冷会话的待审批在 manager 缓冲区，open() 重放）。 */
  pending?: readonly PendingWaitFace[]
}

// ---------- SessionListState 用到的字段 ----------

/** SessionSummary.pendingInteraction（pending.ts 字面量）。 */
export type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/** SessionListState.byId 的值（service.ts SessionSummary 全字段）。 */
export interface OfficeSessionSummary {
  id: string
  displayTitle: string
  cwd?: string
  agentPreset?: string
  parentId?: string
  origin?: 'subagent'
  running: boolean
  pendingInteraction?: PendingInteractionStatus
  completed?: boolean
  blank: boolean
  updatedAt: number
}

/** subagents 域 catalog 行（subagents.ts SubagentListEntry）。 */
export type SubagentListEntry =
  | { kind: 'child'; id: string; activity: 'running' | 'inactive'; hasChildren: boolean; mode: 'one-shot' | 'continuable'; label?: string }
  | { kind: 'diagnostic'; id: string; reason: string }

/** 每个父会话的直接子 agent catalog（manager.ts SubagentCatalogSnapshot）。 */
export interface SubagentCatalogSnapshot {
  entries: readonly SubagentListEntry[]
  parentAvailable: boolean
  state: 'loading' | 'ready' | 'error'
  error: unknown
}

/** useSessions 的 selector 参数：SessionListState 用到的字段子集。 */
export interface OfficeSessionsState {
  ids: readonly string[]
  byId: Record<string, OfficeSessionSummary | undefined>
  current: string | undefined
  subagentsByParent: Readonly<Record<string, SubagentCatalogSnapshot | undefined>>
}
