import { describe, expect, it } from 'vitest'
import { CELL, WalkGrid, findPath, type ObstacleRect } from './pathfinding'

// 400x400 世界（20x20 单元格），y=180~220 横贯一堵墙，仅右侧 x>280 留门
const WORLD = 400
const WALL: ObstacleRect = { x0: 0, y0: 180, x1: 280, y1: 220 }
const grid = new WalkGrid(WORLD, WORLD, [WALL])

function at(cx: number, cy: number) {
  return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 }
}

describe('WalkGrid', () => {
  it('把障碍脚印膨胀标记为不可走', () => {
    expect(grid.walkable(5, 10)).toBe(false)
    expect(grid.walkable(15, 10)).toBe(true)
    expect(grid.walkable(5, 8)).toBe(true)
  })

  it('边界外一律不可走', () => {
    expect(grid.walkable(-1, 5)).toBe(false)
    expect(grid.walkable(5, -1)).toBe(false)
    expect(grid.walkable(20, 5)).toBe(false)
    expect(grid.walkable(5, 20)).toBe(false)
  })

  it('worldWalkable 与网格坐标换算一致', () => {
    expect(grid.worldWalkable(5 * CELL + 1, 10 * CELL + 1)).toBe(false)
    expect(grid.worldWalkable(15 * CELL + 10, 10 * CELL + 10)).toBe(true)
  })

  it('nearestWalkable 从障碍内向外找最近可行走格', () => {
    expect(grid.nearestWalkable(15, 5)).toEqual({ cx: 15, cy: 5 })
    // (5,10) 在墙里，一圈邻居全堵死，返回按扫描序找到的 2 格环上的可行走格
    const n = grid.nearestWalkable(5, 10)
    expect(n).toEqual({ cx: 3, cy: 8 })
    expect(grid.walkable(n!.cx, n!.cy)).toBe(true)
  })
})

describe('findPath', () => {
  it('直线无遮挡时直接返回终点', () => {
    const path = findPath(grid, at(2, 2), at(8, 2))
    expect(path).toBeDefined()
    const last = path![path!.length - 1]
    expect(last.x).toBe(at(8, 2).x)
    expect(last.y).toBe(at(8, 2).y)
  })

  it('起点终点同格时路径只含终点', () => {
    const path = findPath(grid, at(2, 2), { x: 2 * CELL + 7, y: 2 * CELL + 9 })
    expect(path).toEqual([{ x: 2 * CELL + 7, y: 2 * CELL + 9 }])
  })

  it('绕墙时路径穿过门且逐点可行走', () => {
    const start = at(2, 4)
    const goal = at(2, 13)
    const path = findPath(grid, start, goal)
    expect(path).toBeDefined()
    expect(path!.length).toBeGreaterThan(1)
    // 除终点（可能贴合障碍边缘）外每个途经点都应落在可行走格上
    for (const p of path!.slice(0, -1)) {
      expect(grid.worldWalkable(p.x, p.y)).toBe(true)
    }
    // 路径确实经过了右侧的门（x > 280）
    expect(path!.some(p => p.x > 280)).toBe(true)
  })

  it('整个世界都被堵死时返回 undefined', () => {
    const tiny = new WalkGrid(40, 40, [{ x0: 0, y0: 0, x1: 40, y1: 40 }])
    expect(findPath(tiny, { x: 20, y: 20 }, { x: 30, y: 30 })).toBeUndefined()
  })
})
