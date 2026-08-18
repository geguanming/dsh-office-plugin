import type { ObstacleRect } from './pathfinding.ts'

/** 场景虚拟坐标系：1600x1000，摄像机自动缩放适配视口 */
export const WORLD_W = 1600
export const WORLD_H = 1000

/** 墙脚线（地板从这条线开始） */
export const WALL_BOTTOM = 200

export interface DeskSlot {
  x: number
  y: number
  boss: boolean
}

export interface ZoneRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 茶水间（左上，独立房间） */
export const ZONE_PANTRY: ZoneRect = { x0: 36, y0: 214, x1: 300, y1: 420 }
/** 会议室（右上，独立房间） */
export const ZONE_MEETING: ZoneRect = { x0: 1264, y0: 214, x1: 1564, y1: 434 }
/** 休息活动室（左下，独立房间） */
export const ZONE_LOUNGE: ZoneRect = { x0: 36, y0: 490, x1: 300, y1: 956 }
/** 办公区（中部，开放工位） */
export const ZONE_OFFICE: ZoneRect = { x0: 390, y0: 250, x1: 1190, y1: 950 }
/** 老板办公室（右下，独立房间）：老板（用户）专座，牛马勿入 */
export const ZONE_BOSS_OFFICE: ZoneRect = { x0: 1280, y0: 450, x1: 1540, y1: 930 }

/** 家具点位。y 为精灵底部（地板接触点） */
export const FACILITIES = {
  door: { x: 1227, y: 296 },
  punch: { x: 1172, y: 188 },
  counter: { x: 168, y: 262 },
  coffee: { x: 58, y: 330 },
  cooler: { x: 112, y: 330 },
  pantryTable: { x: 230, y: 378 },
  whiteboard: { x: 1414, y: 128 },
  meetingTable: { x: 1414, y: 372 },
  sofa: { x: 166, y: 600 },
  loungeTable: { x: 166, y: 694 },
  tv: { x: 88, y: 810 },
  bookshelf: { x: 168, y: 940 },
  // 办公区上部（老板位两侧）与走廊的填充家具
  officeBookshelf: { x: 430, y: 300 },
  corridorCooler: { x: 350, y: 620 },
  loungeRoundTable: { x: 210, y: 810 },
  // 老板办公室（右下，会议室正下方）：老板（用户）专座
  bossOffice: {
    desk: { x: 1410, y: 700 },
    chair: { x: 1410, y: 764 },
    bookshelf: { x: 1360, y: 546 },
    plant: { x: 1320, y: 900 },
  },
  plants: [
    { x: 560, y: 440 },
    { x: 1150, y: 440 },
    { x: 368, y: 946 },
    { x: 350, y: 720 },
    { x: 1240, y: 560 },
    { x: 250, y: 560 },
  ],
  windows: [
    { x: 300, y: 110 },
    { x: 640, y: 110 },
    { x: 980, y: 110 },
  ],
} as const

/** 会议室装饰椅（上排桌后、下排桌前） */
export const MEETING_CHAIRS = [
  { x: 1364, y: 278 }, { x: 1414, y: 278 }, { x: 1464, y: 278 },
  { x: 1364, y: 398 }, { x: 1414, y: 398 }, { x: 1464, y: 398 },
]

/** 员工走近设施的站立点 */
export const STAND_POINTS = {
  door: { x: 1227, y: 302 },
  punch: { x: 1172, y: 276 },
} as const

// ---------- 房间墙体 ----------

const WALL_T = 12
const DOOR_GAP = 90

/** 单面墙（含门洞则拆成两段） */
function vWall(x: number, y0: number, y1: number, doorCenter?: number): ObstacleRect[] {
  if (doorCenter === undefined) return [{ x0: x, y0, x1: x + WALL_T, y1 }]
  const g0 = doorCenter - DOOR_GAP / 2
  const g1 = doorCenter + DOOR_GAP / 2
  return [
    { x0: x, y0, x1: x + WALL_T, y1: g0 },
    { x0: x, y0: g1, x1: x + WALL_T, y1 },
  ]
}

function hWall(y: number, x0: number, x1: number): ObstacleRect {
  return { x0, y0: y, x1, y1: y + WALL_T }
}

/**
 * 三个独立房间的墙体段（既是绘制依据也是寻路障碍）。
 * 门洞：茶水间/休息室开右侧（朝走廊），会议室开左侧（朝办公区）。
 */
export function roomWalls(): ObstacleRect[] {
  const p = ZONE_PANTRY
  const m = ZONE_MEETING
  const l = ZONE_LOUNGE
  // 老板办公室（会议室正下方，右侧）：左墙开门朝办公区走廊
  const o = ZONE_BOSS_OFFICE
  return [
    // 茶水间：右墙开门，其余三面封闭
    hWall(p.y0 - WALL_T, p.x0, p.x1),
    hWall(p.y1 - WALL_T, p.x0, p.x1),
    { x0: p.x0, y0: p.y0, x1: p.x0 + WALL_T, y1: p.y1 },
    ...vWall(p.x1 - WALL_T, p.y0, p.y1, (p.y0 + p.y1) / 2),
    // 会议室：左墙开门
    hWall(m.y0 - WALL_T, m.x0, m.x1),
    hWall(m.y1 - WALL_T, m.x0, m.x1),
    ...vWall(m.x0, m.y0, m.y1, (m.y0 + m.y1) / 2),
    { x0: m.x1 - WALL_T, y0: m.y0, x1: m.x1, y1: m.y1 },
    // 休息活动室：右墙开门
    hWall(l.y0, l.x0, l.x1),
    hWall(l.y1 - WALL_T, l.x0, l.x1),
    { x0: l.x0, y0: l.y0, x1: l.x0 + WALL_T, y1: l.y1 },
    ...vWall(l.x1 - WALL_T, l.y0, l.y1, (l.y0 + l.y1) / 2),
    // 独立办公间：左墙开门
    hWall(o.y0 - WALL_T, o.x0, o.x1),
    hWall(o.y1 - WALL_T, o.x0, o.x1),
    { x0: o.x1 - WALL_T, y0: o.y0, x1: o.x1, y1: o.y1 },
    ...vWall(o.x0, o.y0, o.y1, (o.y0 + o.y1) / 2),
  ]
}

// ---------- 工位计算 ----------

/** 员工工位网格：固定 4 排 × 4 列（=16，对齐 MAX_EMPLOYEES 上限），人数不足也保持满配桌椅 */
export const CHILD_GRID_COLS = 4
export const CHILD_GRID_ROWS = 4
const GRID_AREA = { x0: 390, x1: 1190, y0: 460, y1: 950 }
const BOSS_Y = 332

/** 老板位：办公区上方，奇偶上下错开半步 */
export function bossDeskRow(bossCount: number): DeskSlot[] {
  const slots: DeskSlot[] = []
  const bosses = Math.max(bossCount, 0)
  const bossDX = Math.min(290, 780 / Math.max(bosses, 1))
  const bossX0 = 790 - ((bosses - 1) * bossDX) / 2
  for (let i = 0; i < bosses; i++) {
    slots.push({ x: bossX0 + i * bossDX, y: BOSS_Y + (i % 2) * 26, boss: true })
  }
  return slots
}

/** 员工工位：固定 4×4 均匀网格 */
export function childDeskGrid(): DeskSlot[] {
  const slots: DeskSlot[] = []
  const cellW = (GRID_AREA.x1 - GRID_AREA.x0) / CHILD_GRID_COLS
  const cellH = (GRID_AREA.y1 - GRID_AREA.y0) / CHILD_GRID_ROWS
  for (let row = 0; row < CHILD_GRID_ROWS; row++) {
    for (let col = 0; col < CHILD_GRID_COLS; col++) {
      slots.push({
        x: GRID_AREA.x0 + (col + 0.5) * cellW,
        y: GRID_AREA.y0 + (row + 0.5) * cellH,
        boss: false,
      })
    }
  }
  return slots
}

/** 家具障碍（中心 + 半宽半高，已含角色半径膨胀）。桌子障碍随工位动态计算。 */
export function staticObstacles(): ObstacleRect[] {
  const rect = (cx: number, cy: number, hw: number, hh: number): ObstacleRect =>
    ({ x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh })
  return [
    rect(FACILITIES.counter.x, 236, 132, 36),
    rect(FACILITIES.coffee.x, 294, 40, 48),
    rect(FACILITIES.cooler.x, 296, 40, 50),
    rect(FACILITIES.pantryTable.x, 362, 58, 30),
    rect(FACILITIES.meetingTable.x, 330, 110, 40),
    rect(FACILITIES.sofa.x, 566, 90, 48),
    rect(FACILITIES.loungeTable.x, 678, 60, 36),
    rect(FACILITIES.tv.x, 770, 46, 44),
    rect(FACILITIES.bookshelf.x, 908, 74, 32),
    // 办公区上部与走廊的填充家具
    rect(FACILITIES.officeBookshelf.x, 292, 70, 36),
    rect(FACILITIES.corridorCooler.x, 610, 24, 36),
    rect(FACILITIES.loungeRoundTable.x, 800, 60, 30),
    // 老板办公室（椅不设障碍，与工位椅一致，方便老板起身寻路）
    rect(FACILITIES.bossOffice.desk.x, FACILITIES.bossOffice.desk.y + 4, 98, 32),
    rect(FACILITIES.bossOffice.bookshelf.x, 546, 70, 40),
    rect(FACILITIES.bossOffice.plant.x, 860, 36, 40),
    ...FACILITIES.plants.map(p => rect(p.x, p.y - 40, 36, 40)),
  ]
}

export function deskObstacle(slot: DeskSlot): ObstacleRect {
  return slot.boss
    ? { x0: slot.x - 92, y0: slot.y - 30, x1: slot.x + 92, y1: slot.y + 40 }
    : { x0: slot.x - 66, y0: slot.y - 26, x1: slot.x + 66, y1: slot.y + 36 }
}

/** 闲逛目的地（均位于可行走区域，带闲聊台词） */
export function wanderTargets(): Array<{ x: number; y: number; hint: string }> {
  return [
    // 茶水间（经右墙门洞进入）
    { x: 170, y: 306, hint: '接杯咖啡' },
    { x: 170, y: 282, hint: '接点水' },
    { x: 230, y: 316, hint: '茶水间聊两句' },
    // 休息活动室（经右墙门洞进入）
    { x: 266, y: 600, hint: '沙发边瘫一会儿' },
    { x: 266, y: 678, hint: '翻翻杂志' },
    { x: 168, y: 848, hint: '找本书看' },
    { x: 266, y: 560, hint: '休息区遛遛' },
    // 会议室（经左墙门洞进入）
    { x: 1414, y: 244, hint: '看看白板' },
    { x: 1440, y: 398, hint: '开个小会' },
    // 办公区与走廊
    { x: 480, y: 470, hint: '望望窗外' },
    { x: 790, y: 470, hint: '活动活动' },
    { x: 1100, y: 470, hint: '伸个懒腰' },
    { x: 790, y: 936, hint: '溜达一圈' },
    { x: 1230, y: 470, hint: '走廊透口气' },
    // 老板办公室不设闲逛点：牛马别去打扰老板
  ]
}

/** 老板办公室内部活动点（老板专属，均在房内可走区域，牛马不来） */
export function bossOfficeStrolls(): Array<{ x: number; y: number; hint: string }> {
  return [
    { x: 1395, y: 618, hint: '翻翻文件' },
    { x: 1470, y: 624, hint: '看看报表' },
    { x: 1385, y: 856, hint: '浇浇花' },
    { x: 1452, y: 842, hint: '站会儿透透气' },
    { x: 1310, y: 486, hint: '门口听听动静' },
  ]
}
