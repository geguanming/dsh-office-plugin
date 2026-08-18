/**
 * 可行走网格 + A* 寻路。家具脚印膨胀后标记为障碍，员工只沿可走单元格
 * 之间的路线移动；路径再做视线拉直（string-pulling）减少锯齿。
 */
export interface ObstacleRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export const CELL = 20

export class WalkGrid {
  readonly cols: number
  readonly rows: number
  private readonly blocked: Uint8Array

  constructor(worldW: number, worldH: number, obstacles: ObstacleRect[]) {
    this.cols = Math.ceil(worldW / CELL)
    this.rows = Math.ceil(worldH / CELL)
    this.blocked = new Uint8Array(this.cols * this.rows)
    for (const rect of obstacles) this.mark(rect)
  }

  private mark(rect: ObstacleRect): void {
    const cx0 = Math.max(0, Math.floor(rect.x0 / CELL))
    const cy0 = Math.max(0, Math.floor(rect.y0 / CELL))
    const cx1 = Math.min(this.cols - 1, Math.floor(rect.x1 / CELL))
    const cy1 = Math.min(this.rows - 1, Math.floor(rect.y1 / CELL))
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) this.blocked[cy * this.cols + cx] = 1
    }
  }

  walkable(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false
    return this.blocked[cy * this.cols + cx] === 0
  }

  worldWalkable(x: number, y: number): boolean {
    return this.walkable(Math.floor(x / CELL), Math.floor(y / CELL))
  }

  /** 找距离最近的可行走单元格（起点/终点落在障碍内时的兜底） */
  nearestWalkable(cx: number, cy: number): { cx: number; cy: number } | undefined {
    if (this.walkable(cx, cy)) return { cx, cy }
    for (let r = 1; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          if (this.walkable(cx + dx, cy + dy)) return { cx: cx + dx, cy: cy + dy }
        }
      }
    }
    return undefined
  }
}

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const

/** A* 搜索（8 向、禁止切角），返回世界坐标路径点（不含起点，含终点） */
export function findPath(grid: WalkGrid, start: { x: number; y: number }, goal: { x: number; y: number }): Array<{ x: number; y: number }> | undefined {
  const toCell = (x: number, y: number) => ({ cx: Math.floor(x / CELL), cy: Math.floor(y / CELL) })
  const s0 = toCell(start.x, start.y)
  const g0 = toCell(goal.x, goal.y)
  const s = grid.nearestWalkable(s0.cx, s0.cy)
  const g = grid.nearestWalkable(g0.cx, g0.cy)
  if (s === undefined || g === undefined) return undefined
  if (s.cx === g.cx && s.cy === g.cy) return [{ x: goal.x, y: goal.y }]

  const total = grid.cols * grid.rows
  const gScore = new Float32Array(total).fill(Infinity)
  const cameFrom = new Int32Array(total).fill(-1)
  const closed = new Uint8Array(total)
  const sIdx = s.cy * grid.cols + s.cx
  const gIdx = g.cy * grid.cols + g.cx
  gScore[sIdx] = 0
  const open: number[] = [sIdx]
  const fScore = new Float32Array(total).fill(Infinity)
  const heuristic = (cx: number, cy: number): number => {
    const dx = Math.abs(cx - g.cx)
    const dy = Math.abs(cy - g.cy)
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy)
  }
  fScore[sIdx] = heuristic(s.cx, s.cy)

  let found = false
  while (open.length > 0) {
    let bestI = 0
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestI]]) bestI = i
    }
    const current = open.splice(bestI, 1)[0]
    if (current === gIdx) { found = true; break }
    closed[current] = 1
    const ccx = current % grid.cols
    const ccy = Math.floor(current / grid.cols)
    for (const [dx, dy] of DIRS) {
      const nx = ccx + dx
      const ny = ccy + dy
      if (!grid.walkable(nx, ny)) continue
      // 斜向移动不允许擦角穿过两个障碍之间
      if (dx !== 0 && dy !== 0 && (!grid.walkable(ccx + dx, ccy) || !grid.walkable(ccx, ccy + dy))) continue
      const nIdx = ny * grid.cols + nx
      if (closed[nIdx] === 1) continue
      const cost = dx !== 0 && dy !== 0 ? 1.414 : 1
      const tentative = gScore[current] + cost
      if (tentative < gScore[nIdx]) {
        gScore[nIdx] = tentative
        fScore[nIdx] = tentative + heuristic(nx, ny)
        cameFrom[nIdx] = current
        if (!open.includes(nIdx)) open.push(nIdx)
      }
    }
  }
  if (!found) return undefined

  // 回溯
  const cells: number[] = []
  for (let cur = gIdx; cur !== -1; cur = cameFrom[cur]) cells.push(cur)
  cells.reverse()
  const points = cells.map(idx => {
    const cx = idx % grid.cols
    const cy = Math.floor(idx / grid.cols)
    return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 }
  })
  if (points.length > 0) points[points.length - 1] = { x: goal.x, y: goal.y }

  // 视线拉直：贪心跳过可直达的中间点
  const smoothed: Array<{ x: number; y: number }> = []
  let anchor = 0
  while (anchor < points.length - 1) {
    let next = anchor + 1
    for (let probe = points.length - 1; probe > anchor + 1; probe--) {
      if (lineOfSight(grid, points[anchor], points[probe])) { next = probe; break }
    }
    smoothed.push(points[next])
    anchor = next
  }
  return smoothed
}

function lineOfSight(grid: WalkGrid, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const steps = Math.ceil(dist / 8)
  for (let i = 1; i < steps; i++) {
    const k = i / steps
    if (!grid.worldWalkable(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)) return false
  }
  return true
}
