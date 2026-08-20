/**
 * 自定义人名：按稳定 key（session id 或 'the-owner' 老板）存到 localStorage，
 * 刷新后保留。场景名牌与信息卡共享同一份，改动经订阅实时同步。
 */

const STORAGE_KEY = 'dsh-office.custom-names.v1'

interface StoredShape {
  names?: Record<string, string>
}

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as StoredShape
    if (parsed !== null && typeof parsed === 'object' && parsed.names !== null && typeof parsed.names === 'object') {
      return parsed.names
    }
  } catch {
    // localStorage 不可用或 JSON 损坏：静默回退到默认名
  }
  return {}
}

let cache: Record<string, string> = load()
let version = 0
const listeners = new Set<() => void>()

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ names: cache } satisfies StoredShape))
  } catch {
    // 隐私模式 / 配额满：本次会话内仍生效
  }
}

/** 取自定义名；未设置返回 undefined，由调用方回退到默认名 */
export function getCustomName(key: string): string | undefined {
  const name = cache[key]?.trim()
  return name !== '' && name !== undefined ? name : undefined
}

/** 设置（空串等同于清除）并通知所有订阅者 */
export function setCustomName(key: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed === '') {
    if (!(key in cache)) return
    delete cache[key]
  } else {
    if (cache[key] === trimmed) return
    cache = { ...cache, [key]: trimmed }
  }
  version++
  persist()
  for (const fn of listeners) fn()
}

/** 订阅自定义名变化（任一 key 改动即触发）；返回取消订阅函数 */
export function subscribeNames(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 自增版本号：供 React useSyncExternalStore 作为快照触发重渲染 */
export function namesVersion(): number {
  return version
}

/** 老板（右下角本尊，不对应任何会话）的稳定 key */
export const OWNER_KEY = 'the-owner'
export const OWNER_DEFAULT_NAME = '老板'

/** 老板显示名：自定义优先，否则「老板」 */
export function ownerName(): string {
  return getCustomName(OWNER_KEY) ?? OWNER_DEFAULT_NAME
}
