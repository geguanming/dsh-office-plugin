import { Application, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import { Employee, type EmployeeInfo, type EmployeeStatus } from './employee.ts'
import { TextureBank } from './textures.ts'
import { Particles } from './ambient.ts'
import {
  bossDeskRow, childDeskGrid, deskObstacle, staticObstacles, wanderTargets, roomWalls, STAND_POINTS,
  FACILITIES, MEETING_CHAIRS, WALL_BOTTOM, WORLD_H, WORLD_W, bossOfficeStrolls,
  ZONE_LOUNGE, ZONE_MEETING, ZONE_OFFICE, ZONE_PANTRY, ZONE_BOSS_OFFICE,
  type DeskSlot, type ZoneRect,
} from './officeLayout.ts'
import { WalkGrid, findPath } from './pathfinding.ts'
import { hashString, mulberry32, ownerLook } from './palette.ts'
import { ownerName, subscribeNames } from '../names.ts'

/** 数据源：场景按秒轮询它拿员工清单 */
export interface EmployeeSource {
  list(): EmployeeInfo[]
}

export interface OfficeSceneHooks {
  onSelect?(id: string): void
  /** 点击某员工的显示器屏幕时触发（仅工作中屏幕可点） */
  onSelectScreen?(id: string): void
  /** 点击老板（用户）时触发：弹出迷你输入条给老板发号施令 */
  onOwnerTap?(): void
}

interface Workstation {
  container: Container
  /** 椅子挂在世界层（不在工位容器内）：层级要压在坐着的员工之上 */
  chair: Sprite
  monitor: Sprite
  glow: Sprite
  /** 屏幕透明热区：仅工作中可点，触发 onSelectScreen */
  screenHit: Graphics
  slot: DeskSlot
  ownerId: string | null
}

type WalkPurpose = 'desk' | 'wander'

interface Record_ {
  employee: Employee
  workstation: Workstation
  root: boolean
  status: EmployeeStatus
  statusSince: number
  detail: string | undefined
  lastDetail: string
  lastWander: number
  wanderLingerUntil: number
  wanderHint: string
  walkPurpose: WalkPurpose
  zzzAt: number
  pending: boolean
  pendingAt: number
}

const SYNC_INTERVAL = 1.0
/** 实时活动（对话/工具）刷新节流：多 agent 场景下降低遍历频率，避免持续扫描海量会话 */
const DETAIL_INTERVAL = 0.5
const IDLE_WANDER_DELAY = 4
const IDLE_SLEEP_AFTER = 150
/** 有待拍板交互时，头顶冒泡提醒的间隔（秒） */
const PENDING_NAG_INTERVAL = 7

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

/** 老板摸鱼语录（进入摸鱼时随机一句） */
const OWNER_SLACK_LINES = ['☕ 摸鱼中，勿扰', '让牛马先跑一会儿', '这咖啡不错', '眯一会儿…', '当老板嘛，重在参与']

export function createOfficeScene(app: Application, source: EmployeeSource, hooks: OfficeSceneHooks = {}): { destroy(): void; bossOrders(): void } {
  const bank = new TextureBank(app.renderer)
  const world = new Container()
  world.sortableChildren = true
  app.stage.addChild(world)

  const particles = new Particles(world, app.renderer)

  buildRoom(world, bank)

  const stations = new Map<string, Workstation>()
  const records = new Map<string, Record_>()
  const sceneRand = mulberry32(20260817)
  let elapsed = 0
  let syncTimer = SYNC_INTERVAL
  let detailTimer = DETAIL_INTERVAL
  let lastW = 0
  let lastH = 0
  let grid = new WalkGrid(WORLD_W, WORLD_H, staticObstacles())

  // ---- 摄像机：自适应 fit + 交互（拖拽平移 / 滚轮缩放 / 双击复位） ----
  const MAX_SCALE = 3.5
  const camera = { scale: 1, x: 0, y: 0 }

  /** 完整视野的等比缩放（contain），也是缩放下限 */
  const containScale = (): number =>
    Math.min(app.screen.width / WORLD_W, app.screen.height / WORLD_H) * 0.97

  const applyCamera = (): void => {
    world.scale.set(camera.scale)
    world.position.set(camera.x, camera.y)
  }

  /** 平移 clamp：世界尽量不拖出视野；完整视野时锁定居中 */
  const clampCamera = (): void => {
    const w = WORLD_W * camera.scale
    const h = WORLD_H * camera.scale
    camera.x = Math.min(0, Math.max(app.screen.width - w, camera.x))
    camera.y = Math.min(0, Math.max(app.screen.height - h, camera.y))
    if (w <= app.screen.width) camera.x = (app.screen.width - w) / 2
    if (h <= app.screen.height) camera.y = (app.screen.height - h) / 2
  }

  /** 自适应 fit：contain 最远视角，整个办公室完整可见（展开面板即处于此视角） */
  const autoFit = (): void => {
    camera.scale = containScale()
    camera.x = (app.screen.width - WORLD_W * camera.scale) / 2
    camera.y = (app.screen.height - WORLD_H * camera.scale) / 2
    applyCamera()
  }

  const fitCamera = (): void => {
    if (app.screen.width === lastW && app.screen.height === lastH) return
    lastW = app.screen.width
    lastH = app.screen.height
    autoFit()
  }

  // 交互事件绑在 canvas 的 DOM 层：位移超过阈值才算拖拽，Pixi 的员工 tap
  // 只在原地触发，两者天然互斥，无需禁用 Pixi 事件
  const DRAG_THRESHOLD = 5
  let dragStart: { x: number; y: number; camX: number; camY: number } | null = null
  let dragging = false

  const onPointerDown = (e: PointerEvent): void => {
    dragStart = { x: e.clientX, y: e.clientY, camX: camera.x, camY: camera.y }
    dragging = false
    app.canvas.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent): void => {
    if (dragStart === null) return
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragging = true
    if (!dragging) return
    app.canvas.style.cursor = 'grabbing'
    camera.x = dragStart.camX + dx
    camera.y = dragStart.camY + dy
    clampCamera()
    applyCamera()
  }
  const onPointerUp = (e: PointerEvent): void => {
    if (app.canvas.hasPointerCapture(e.pointerId)) app.canvas.releasePointerCapture(e.pointerId)
    dragStart = null
    dragging = false
    app.canvas.style.cursor = 'grab'
  }
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const rect = app.canvas.getBoundingClientRect()
    // 以光标为锚点缩放：保持光标下的世界点不动
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const factor = Math.exp(-e.deltaY * 0.0015)
    const next = Math.max(containScale(), Math.min(MAX_SCALE, camera.scale * factor))
    if (next === camera.scale) return
    const wx = (px - camera.x) / camera.scale
    const wy = (py - camera.y) / camera.scale
    camera.scale = next
    camera.x = px - wx * next
    camera.y = py - wy * next
    clampCamera()
    applyCamera()
  }
  const onDoubleClick = (): void => { autoFit() }

  app.canvas.addEventListener('pointerdown', onPointerDown)
  app.canvas.addEventListener('pointermove', onPointerMove)
  app.canvas.addEventListener('pointerup', onPointerUp)
  app.canvas.addEventListener('pointercancel', onPointerUp)
  app.canvas.addEventListener('wheel', onWheel, { passive: false })
  app.canvas.addEventListener('dblclick', onDoubleClick)
  app.canvas.style.cursor = 'grab'

  /** 寻路走固定路线；无路可达时兜底直走（正常布局不会发生） */
  const routeTo = (rec: Record_, target: { x: number; y: number }, purpose: WalkPurpose): void => {
    rec.walkPurpose = purpose
    const path = findPath(grid, { x: rec.employee.container.x, y: rec.employee.container.y }, target)
    if (path !== undefined && path.length > 0) rec.employee.startWalkPath(path)
    else rec.employee.startWalkTo(target)
  }

  const deskStandPoint = (slot: DeskSlot): { x: number; y: number } =>
    ({ x: slot.x, y: slot.y + 96 })

  const monOff = bank.monitorOff()
  const monFrames = bank.monitorFrames()

  const makeWorkstation = (slot: DeskSlot): Workstation => {
    const c = new Container()
    c.position.set(slot.x, slot.y)
    c.zIndex = slot.y
    c.sortableChildren = true

    // 工位容器（桌面 < 显示器 < 辉光 < 名牌）+ 独立椅背层
    const desk = new Sprite(bank.desk(slot.boss))
    desk.anchor.set(0.5, 0)
    desk.position.set(0, 0)
    desk.zIndex = 1
    c.addChild(desk)

    const monitor = new Sprite(monOff)
    monitor.anchor.set(0.5, 1)
    monitor.position.set(0, 26)
    monitor.zIndex = 2
    c.addChild(monitor)

    const glow = new Sprite(bank.glow('rgba(140, 200, 255, 0.5)'))
    glow.anchor.set(0.5, 0.5)
    glow.position.set(0, -28)
    glow.scale.set(0.6)
    glow.zIndex = 4
    glow.blendMode = 'add'
    glow.visible = false
    c.addChild(glow)

    world.addChild(c)
    // 椅子在世界层：zIndex 略高于工位与坐姿员工（slot.y+1），
    // 员工坐在椅子上、被椅背挡住后背，只露出后脑勺
    const chair = new Sprite(bank.officeChair())
    chair.anchor.set(0.5, 1)
    chair.position.set(slot.x, slot.y + 64)
    chair.zIndex = slot.y + 2
    world.addChild(chair)

    // 屏幕透明热区也挂世界层，zIndex 压过坐姿员工，使其可被点中
    const screenHit = new Graphics()
    screenHit.zIndex = slot.y + 6
    screenHit.roundRect(-33, -16, 66, 32, 3).fill({ color: 0xFFFFFF, alpha: 0.001 })
    screenHit.position.set(slot.x, slot.y - 42)
    screenHit.eventMode = 'none'
    screenHit.cursor = 'pointer'
    world.addChild(screenHit)

    return { container: c, chair, monitor, glow, screenHit, slot, ownerId: null }
  }

  // ---- 老板办公室（右下角）：老板（用户）本人，不对应任何会话，永不离座 ----
  const bossOffice = FACILITIES.bossOffice
  const bossDeskBox = new Container()
  bossDeskBox.position.set(bossOffice.desk.x, bossOffice.desk.y)
  bossDeskBox.zIndex = bossOffice.desk.y
  bossDeskBox.sortableChildren = true

  const bossDeskTop = new Sprite(bank.desk(true))
  bossDeskTop.anchor.set(0.5, 0)
  bossDeskTop.zIndex = 1
  bossDeskBox.addChild(bossDeskTop)

  const ownerMonitor = new Sprite(monOff)
  ownerMonitor.anchor.set(0.5, 1)
  ownerMonitor.position.set(0, 26)
  ownerMonitor.zIndex = 2
  bossDeskBox.addChild(ownerMonitor)

  const ownerGlow = new Sprite(bank.glow('rgba(212, 160, 23, 0.45)'))
  ownerGlow.anchor.set(0.5, 0.5)
  ownerGlow.position.set(0, -28)
  ownerGlow.scale.set(0.6)
  ownerGlow.zIndex = 4
  ownerGlow.blendMode = 'add'
  bossDeskBox.addChild(ownerGlow)

  const ownerPlate = new Text({ text: ownerName(), style: { fill: '#8A5A2B', fontSize: 12, fontFamily: FONT, fontWeight: '700' } })
  ownerPlate.anchor.set(0.5)
  ownerPlate.position.set(-74, 20)
  ownerPlate.zIndex = 3
  bossDeskBox.addChild(ownerPlate)
  world.addChild(bossDeskBox)

  const ownerChair = new Sprite(bank.bossChair())
  ownerChair.anchor.set(0.5, 1)
  ownerChair.position.set(bossOffice.desk.x, bossOffice.desk.y + 64)
  ownerChair.zIndex = bossOffice.desk.y + 2
  world.addChild(ownerChair)

  const owner = new Employee('the-owner', bank, false, ownerLook())
  owner.container.position.set(bossOffice.desk.x, bossOffice.desk.y + 56)
  owner.container.zIndex = bossOffice.desk.y + 1
  owner.atDesk = true
  owner.pose('type')
  owner.container.onpointertap = () => hooks.onOwnerTap?.()
  owner.container.cursor = 'pointer'
  const crown = new Sprite(bank.bossCrown())
  crown.anchor.set(0.5, 1)
  crown.position.set(0, -84)
  crown.scale.set(0.8)
  owner.container.addChild(crown)
  world.addChild(owner.container)

  // 老板活动节律：办公 20~50 秒 -> 趴桌摸鱼或起身在办公室内溜达 -> 回座，循环；
  // 溜达目标只取 bossOfficeStrolls()（均在房内），老板从不走出办公室
  type OwnerState = 'work' | 'slack' | 'stroll' | 'pause' | 'return'
  let ownerState: OwnerState = 'work'
  let ownerUntil = 14
  let ownerStrollHint = ''

  const ownerStrolls = bossOfficeStrolls()
  const pickStroll = (): { x: number; y: number; hint: string } =>
    ownerStrolls[Math.floor(sceneRand() * ownerStrolls.length)]

  const ownerWalkTo = (target: { x: number; y: number }): void => {
    owner.atDesk = false
    const path = findPath(grid, { x: owner.container.x, y: owner.container.y }, target)
    if (path !== undefined && path.length > 0) owner.startWalkPath(path)
    else owner.startWalkTo(target)
  }

  /**
   * 工位布局：16 个员工工位（4×4）+ 老板位常驻渲染（空位也摆桌椅），
   * 员工按顺序入座。人数变化只影响谁坐哪，桌子不动。
   */
  const placeWorkstations = (): void => {
    const ordered = [...records.values()]
    const roots = ordered.filter(r => r.root)

    const want = new Map<string, DeskSlot>()
    bossDeskRow(roots.length).forEach((slot, i) => want.set(`boss-${i}`, slot))
    childDeskGrid().forEach((slot, i) => want.set(`child-${i}`, slot))
    if (ordered.length > want.size) {
      console.warn(`[dsh-office] 员工 ${ordered.length} 超过工位 ${want.size}，出现分配不足`)
    }

    for (const [key, slot] of want) {
      let ws = stations.get(key)
      if (ws === undefined) {
        ws = makeWorkstation(slot)
        stations.set(key, ws)
      } else {
        ws.container.position.set(slot.x, slot.y)
        ws.container.zIndex = slot.y
        ws.chair.position.set(slot.x, slot.y + 64)
        ws.chair.zIndex = slot.y + 2
        ws.screenHit.position.set(slot.x, slot.y - 42)
        ws.screenHit.zIndex = slot.y + 6
      }
      ws.slot = slot
    }
    for (const key of [...stations.keys()]) {
      if (!want.has(key)) {
        const ws = stations.get(key)
        ws?.container.destroy({ children: true })
        ws?.chair.destroy()
        ws?.screenHit.destroy()
        stations.delete(key)
      }
    }

    const assign = (rec: Record_, ws: Workstation): void => {
      if (ws.ownerId !== rec.employee.id) {
        ws.ownerId = rec.employee.id
        ws.screenHit.onpointertap = (e): void => {
          e.stopPropagation()
          hooks.onSelectScreen?.(rec.employee.id)
        }
      }
      rec.workstation = ws
      rec.employee.sitAt(ws.slot, false)
      if (rec.employee.atDesk && !rec.employee.isWalking()) {
        rec.employee.container.position.set(ws.slot.x, ws.slot.y + 56)
      }
    }
    // 全新分配：重置所有工位占用
    for (const ws of stations.values()) ws.ownerId = null

    // 总监固定总监位（按 root 会话数量）
    roots.forEach((rec, i) => { const ws = stations.get(`boss-${i}`); if (ws !== undefined) assign(rec, ws) })

    // 员工：按 id 哈希确定性随机分配空闲工位（未占用校验，不重复；同一员工每次工位稳定）
    const freePool = [...stations.values()].filter(ws => ws.slot.boss === false)
    for (const rec of ordered) {
      if (rec.root) continue
      if (freePool.length === 0) break
      const start = hashString(rec.employee.id) % freePool.length
      let found = -1
      for (let k = 0; k < freePool.length; k++) {
        const idx = (start + k) % freePool.length
        if (freePool[idx].ownerId === null) { found = idx; break }
      }
      if (found === -1) break
      const ws = freePool[found]
      assign(rec, ws)
      ws.ownerId = rec.employee.id
    }

    // 兜底：工位不足时复用 child 工位，保证每个员工都有工作站（防极端情况崩溃）
    const childKeys = [...stations.keys()].filter(k => k.startsWith('child-')).sort()
    for (let i = 0; i < ordered.length; i++) {
      const rec = ordered[i]
      if (rec.root || rec.workstation !== undefined) continue
      const ws = stations.get(childKeys[i % childKeys.length])
      if (ws !== undefined) assign(rec, ws)
    }

    // 工位与房间墙体变化后重建可行走网格（空工位同样是障碍）
    const deskRects = [...stations.values()].map(ws => deskObstacle(ws.slot))
    grid = new WalkGrid(WORLD_W, WORLD_H, [...staticObstacles(), ...roomWalls(), ...deskRects])
  }

  /** 老板发话：总监冒泡喊话，并把所有在外闲逛的员工叫回工位 */
  const bossAnnounce = (): void => {
    for (const r of records.values()) {
      if (!r.root) continue
      r.employee.say('老板发话了，都给我干起来！', 3.5)
      break
    }
    for (const r of records.values()) {
      if (!r.root) r.wanderLingerUntil = 0
    }
  }

  // 数据同步：增删员工、状态变更
  const sync = (): void => {
    const infos = source.list()
    const seen = new Set<string>()
    for (const info of infos) {
      seen.add(info.id)
      let rec = records.get(info.id)
      if (rec === undefined) {
        const employee = new Employee(info.id, bank, info.root)
        employee.container.zIndex = STAND_POINTS.door.y
        employee.container.position.set(STAND_POINTS.door.x, STAND_POINTS.door.y)
        // 新建员工从门口进场：先标记不在工位，避免 placeWorkstations 把人直接吸附到座位
        employee.atDesk = false
        employee.container.onpointertap = () => hooks.onSelect?.(info.id)
        world.addChild(employee.container)
        rec = {
          employee,
          workstation: undefined as unknown as Workstation,
          root: info.root,
          status: info.status,
          statusSince: elapsed,
          detail: info.detail,
          lastDetail: info.detail ?? '',
          lastWander: elapsed,
          // 摸鱼员工在门口错峰停留 0~3 秒再走向工位（工作中的员工由 tick 立刻派路）
          wanderLingerUntil: info.status === 'idle' ? elapsed + (hashString(info.id) % 1000) / 1000 * 3 : 0,
          wanderHint: '',
          walkPurpose: 'desk',
          zzzAt: 0,
          pending: info.pending === true,
          // 进场后 ~2 秒首次冒泡（错峰），之后按固定间隔
          pendingAt: elapsed + 1.5 + (hashString(info.id) % 1000) / 1000 * 2,
        }
        records.set(info.id, rec)
        placeWorkstations()
        employee.pose('stand')
      }
      const prevStatus = rec.status
      if (rec.status !== info.status) {
        rec.status = info.status
        rec.statusSince = elapsed
      }
      // 新建会话后总监换人：旧总监降级时 root 变 false，工位与外观必须跟着换，
      // 否则陈旧的 root 会随会话数累积出一排总监位
      if (rec.root !== info.root) {
        rec.root = info.root
        rec.employee.relook(bank, info.root)
        placeWorkstations()
      }
      // 总监接到真老板（用户）的新指令：喊话并把所有在外的员工叫回工位
      if (info.root && info.status === 'working' && prevStatus !== 'working') {
        owner.say('刚提了个需求，加急～', 3)
        bossAnnounce()
      }
      rec.detail = info.detail
      rec.pending = info.pending === true
    }
    for (const [id, rec] of records) {
      if (!seen.has(id) && !rec.employee.container.destroyed) {
        rec.employee.destroy()
        records.delete(id)
        placeWorkstations()
      }
    }
  }

  const poseFor = (rec: Record_): string => {
    const emp = rec.employee
    if (emp.isWalking()) return 'walk'
    if (!emp.atDesk) return 'stand'
    if (rec.status === 'working') return 'type'
    return elapsed - rec.statusSince > IDLE_SLEEP_AFTER ? 'sleep' : 'sit'
  }

  const onArrived = (rec: Record_): void => {
    const emp = rec.employee
    if (rec.walkPurpose === 'desk') {
      emp.atDesk = true
      if (rec.workstation !== undefined) {
        emp.container.position.set(rec.workstation.slot.x, rec.workstation.slot.y + 56)
      }
      return
    }
    // 到达闲逛点：站一会儿，随后回座位
    rec.wanderLingerUntil = elapsed + 2.5 + sceneRand() * 3.5
    emp.pose('stand')
    if (rec.wanderHint !== '' && sceneRand() < 0.75) emp.say(rec.wanderHint, 2.2)
  }

  /** 实时活动刷新：detail 变化（流式文本/工具）触发气泡，替代随机概率 */
  const refreshDetail = (): void => {
    const infos = source.list()
    for (const info of infos) {
      const rec = records.get(info.id)
      if (rec === undefined) continue
      const detail = info.detail ?? ''
      if (detail === rec.lastDetail) continue
      rec.lastDetail = detail
      if (detail !== '') rec.employee.say(detail, 2.2)
    }
  }

  const tick = (): void => {
    try {
      fitCamera()
      const dt = Math.min(app.ticker.deltaMS / 1000, 0.1)
      elapsed += dt
      particles.update(dt)
      if (sceneRand() < dt * 1.2) particles.steam(FACILITIES.coffee.x + 14, FACILITIES.coffee.y - 44)

      // 老板节律：办公为主，间歇趴桌摸鱼或起身在办公室内溜达（不出房门）
      const ownerEvent = owner.update(dt)
      if (ownerState === 'work' && elapsed > ownerUntil) {
        if (sceneRand() < 0.5) {
          ownerState = 'slack'
          ownerUntil = elapsed + 6 + sceneRand() * 9
          owner.say(OWNER_SLACK_LINES[Math.floor(sceneRand() * OWNER_SLACK_LINES.length)], 3)
        } else {
          const pick = pickStroll()
          ownerState = 'stroll'
          ownerStrollHint = pick.hint
          ownerWalkTo(pick)
        }
      } else if (ownerState === 'slack' && elapsed > ownerUntil) {
        ownerState = 'work'
        ownerUntil = elapsed + 20 + sceneRand() * 30
      } else if (ownerState === 'stroll' && ownerEvent === 'arrived') {
        ownerState = 'pause'
        ownerUntil = elapsed + 3 + sceneRand() * 4
        owner.say(ownerStrollHint, 2.5)
      } else if (ownerState === 'pause' && elapsed > ownerUntil) {
        if (sceneRand() < 0.35) {
          const pick = pickStroll()
          ownerState = 'stroll'
          ownerStrollHint = pick.hint
          ownerWalkTo(pick)
        } else {
          ownerState = 'return'
          ownerWalkTo({ x: bossOffice.desk.x, y: bossOffice.desk.y + 96 })
        }
      } else if (ownerState === 'return' && ownerEvent === 'arrived') {
        owner.atDesk = true
        owner.container.position.set(bossOffice.desk.x, bossOffice.desk.y + 56)
        ownerState = 'work'
        ownerUntil = elapsed + 20 + sceneRand() * 30
      }
      owner.pose(owner.isWalking() ? 'walk' : ownerState === 'slack' ? 'sleep' : owner.atDesk ? 'type' : 'stand')
      owner.container.zIndex = owner.atDesk ? bossOffice.desk.y + 1 : owner.container.y + 4
      const ownerWorking = ownerState === 'work'
      ownerMonitor.texture = ownerWorking
        ? monFrames[Math.floor(elapsed * 2.4) % monFrames.length]
        : monOff
      ownerGlow.visible = ownerWorking
      if (ownerWorking) ownerGlow.alpha = 0.7 + Math.sin(elapsed * 3) * 0.2

      syncTimer -= dt
      if (syncTimer <= 0) {
        syncTimer = SYNC_INTERVAL
        sync()
      }

      detailTimer -= dt
      if (detailTimer <= 0) {
        detailTimer = DETAIL_INTERVAL
        refreshDetail()
      }

      for (const rec of records.values()) {
        const emp = rec.employee

        const event = emp.update(dt)
        if (event === 'arrived') onArrived(rec)

        // 摸鱼游走决策：空闲坐久了起来溜达
        if (rec.status === 'idle' && !emp.isWalking() && emp.atDesk
          && elapsed - rec.statusSince > IDLE_WANDER_DELAY && elapsed - rec.lastWander > 8 && sceneRand() < dt * 0.25) {
          rec.lastWander = elapsed
          const targets = wanderTargets()
          const pick = targets[Math.floor(sceneRand() * targets.length)]
          rec.wanderHint = pick.hint
          routeTo(rec, pick, 'wander')
          emp.pose('walk')
        }
        // 回座位：接到活（工作中）立刻回工位；摸鱼溜达完休整够了再回。
        if (!emp.isWalking() && !emp.atDesk) {
          const ordered = rec.status === 'working' || (rec.status === 'idle' && rec.root && records.size > 1)
          if (ordered || (rec.status === 'idle' && elapsed > rec.wanderLingerUntil)) {
            routeTo(rec, rec.workstation !== undefined
              ? deskStandPoint(rec.workstation.slot)
              : { x: STAND_POINTS.door.x, y: STAND_POINTS.door.y }, 'desk')
            emp.pose('walk')
          }
        }

        emp.pose(poseFor(rec))

        // 睡觉员工头顶飘 Zzz
        if (!emp.isWalking() && emp.atDesk && rec.status === 'idle'
          && elapsed - rec.statusSince > IDLE_SLEEP_AFTER && elapsed - rec.zzzAt > 1.6) {
          rec.zzzAt = elapsed
          particles.zzz(emp.container.x + 12, emp.container.y - 40)
        }

        // 有待拍板：周期冒泡举手提醒（区别于纯装饰——信息卡内有真按钮可处理）
        if (rec.pending && elapsed > rec.pendingAt) {
          rec.pendingAt = elapsed + PENDING_NAG_INTERVAL
          emp.say('🙋等拍板…', 2.4)
        }

        // 工位屏幕表现：工作中循环播放代码滚动帧
        const working = rec.status === 'working'
        if (rec.workstation !== undefined) {
          rec.workstation.monitor.texture = working
            ? monFrames[Math.floor(elapsed * 2.4 + rec.workstation.slot.x * 0.13) % monFrames.length]
            : monOff
          rec.workstation.glow.visible = working
          if (working) rec.workstation.glow.alpha = 0.7 + Math.sin(elapsed * 3 + rec.employee.container.x) * 0.2
          // 仅工作中的屏幕可点击打开工作监控
          rec.workstation.screenHit.eventMode = working ? 'static' : 'none'
        }

        emp.container.zIndex = rec.workstation !== undefined && emp.atDesk
          ? rec.workstation.slot.y + 1
          : emp.container.y + 4
      }
    } catch (error) {
      // 兜底：单帧异常不应中断 Pixi 渲染循环（否则场景冻结、员工不动）
      console.error('[dsh-office] scene tick error:', error)
    }
  }

  sync()
  autoFit()
  app.ticker.add(tick)

  // 自定义人名改动：刷新老板办公桌名牌（员工无世界名牌，信息卡侧经 React 重渲染读取）
  const unsubscribeNames = subscribeNames(() => {
    ownerPlate.text = ownerName()
  })

  return {
    /** 老板刚发完指令：立刻触发总监喊话（不等会话状态沿） */
    bossOrders() {
      owner.say('这个需求很简单，马上安排', 2.5)
      bossAnnounce()
    },
    destroy() {
      unsubscribeNames()
      app.ticker.remove(tick)
      app.canvas.removeEventListener('pointerdown', onPointerDown)
      app.canvas.removeEventListener('pointermove', onPointerMove)
      app.canvas.removeEventListener('pointerup', onPointerUp)
      app.canvas.removeEventListener('pointercancel', onPointerUp)
      app.canvas.removeEventListener('wheel', onWheel)
      app.canvas.removeEventListener('dblclick', onDoubleClick)
      app.canvas.style.cursor = ''
      world.destroy({ children: true })
      bank.destroy()
      particles.destroy()
    },
  }
}

/** 房间静态装修：地板、三个砌墙的独立房间、开放办公区、门窗与家具 */
function buildRoom(world: Container, bank: TextureBank): void {
  const room = new Container()
  room.zIndex = -100
  room.sortableChildren = true

  // 地板与墙面向左右延伸（宽屏下铺满画面，不出灰边）
  const EXT = 1600
  const floor = new Graphics()
  floor.rect(-EXT, 0, WORLD_W + EXT * 2, WORLD_H).fill('#E8DCC8')
  for (let y = WALL_BOTTOM + 60; y < WORLD_H; y += 78) {
    floor.rect(-EXT, y, WORLD_W + EXT * 2, 2).fill('#DFD2BB', 0.5)
  }
  room.addChild(floor)

  const zoneFloor = new Graphics()
  const zone = (r: ZoneRect, fill: string) => {
    zoneFloor.roundRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 14).fill(fill)
  }
  zone(ZONE_PANTRY, '#EFE7D3')
  zone(ZONE_MEETING, '#E2E6E9')
  zone(ZONE_LOUNGE, '#EBDFC8')
  zone(ZONE_OFFICE, '#E6D9C2')
  zone(ZONE_BOSS_OFFICE, '#E0D2B4')
  // 老板办公室地毯
  zoneFloor.ellipse((ZONE_BOSS_OFFICE.x0 + ZONE_BOSS_OFFICE.x1) / 2, 700, 118, 150).fill('#CBB88C', 0.45)
  // 茶水间格砖 + 休息区地毯
  for (let gy = ZONE_PANTRY.y0; gy < ZONE_PANTRY.y1 - 16; gy += 34) {
    for (let gx = ZONE_PANTRY.x0; gx < ZONE_PANTRY.x1 - 16; gx += 34) {
      if (((gx / 34 | 0) + (gy / 34 | 0)) % 2 === 0) zoneFloor.rect(gx + 2, gy + 2, 30, 30).fill('#E2D6BC', 0.45)
    }
  }
  zoneFloor.ellipse((ZONE_LOUNGE.x0 + ZONE_LOUNGE.x1) / 2, 690, 112, 122).fill('#D9C4A4', 0.5)
  room.addChild(zoneFloor)

  const label = (text: string, x: number, y: number, color: string) => {
    const t = new Text({ text, style: { fill: color, fontSize: 21, fontFamily: FONT, fontWeight: '600' } })
    t.anchor.set(0.5)
    t.position.set(x, y)
    t.alpha = 0.4
    room.addChild(t)
  }
  label('茶 水 间', 168, 302, '#A08A5F')
  label('会 议 室', 1414, 244, '#7C8794')
  label('休息活动室', 166, 476, '#A08A5F')
  label('办 公 区', 790, 272, '#A08A5F')
  label('老板办公室', 1410, 482, '#A08A5F')

  const add = (tex: Texture, x: number, y: number, anchorBottom = true, z = 10) => {
    const s = new Sprite(tex)
    s.anchor.set(0.5, anchorBottom ? 1 : 0.5)
    s.position.set(x, y)
    s.zIndex = z
    room.addChild(s)
  }

  // 背景墙（延伸）
  const wall = new Graphics()
  wall.rect(-EXT, 0, WORLD_W + EXT * 2, WALL_BOTTOM).fill('#F7F3EB')
  wall.rect(-EXT, WALL_BOTTOM - 10, WORLD_W + EXT * 2, 10).fill('#E5DCCB')
  wall.zIndex = -1
  room.addChild(wall)
  for (const w of FACILITIES.windows) add(bank.window(), w.x, w.y, false, 0)
  add(bank.wallClock(), 1150, 100, false, 0)

  // 三个独立房间的墙体（数据同寻路障碍，绘制带描边和高光）
  const wallG = new Graphics()
  for (const seg of roomWalls()) {
    wallG.roundRect(seg.x0, seg.y0, seg.x1 - seg.x0, seg.y1 - seg.y0, 3).fill('#DCD0B6')
    wallG.roundRect(seg.x0, seg.y0, seg.x1 - seg.x0, seg.y1 - seg.y0, 3).stroke({ width: 1.5, color: '#B3A483' })
    wallG.rect(seg.x0, seg.y0, seg.x1 - seg.x0, 3).fill('#EDE4D0')
  }
  wallG.zIndex = 20
  room.addChild(wallG)

  add(bank.door(), FACILITIES.door.x, FACILITIES.door.y, true, 1)
  add(bank.punchClock(), FACILITIES.punch.x, FACILITIES.punch.y, false, 1)

  // 茶水间
  add(bank.counter(), FACILITIES.counter.x, FACILITIES.counter.y)
  add(bank.coffeeMachine(), FACILITIES.coffee.x, FACILITIES.coffee.y)
  add(bank.waterCooler(), FACILITIES.cooler.x, FACILITIES.cooler.y)
  add(bank.roundTable(), FACILITIES.pantryTable.x, FACILITIES.pantryTable.y)

  // 会议室
  add(bank.whiteboard(), FACILITIES.whiteboard.x, FACILITIES.whiteboard.y, false, 1)
  for (const c of MEETING_CHAIRS) add(bank.chair(), c.x, c.y, true, c.y)
  add(bank.meetingTable(), FACILITIES.meetingTable.x, FACILITIES.meetingTable.y, true, 380)

  // 休息活动室
  add(bank.sofa(), FACILITIES.sofa.x, FACILITIES.sofa.y)
  add(bank.loungeTable(), FACILITIES.loungeTable.x, FACILITIES.loungeTable.y)
  add(bank.tv(), FACILITIES.tv.x, FACILITIES.tv.y)
  add(bank.bookshelf(), FACILITIES.bookshelf.x, FACILITIES.bookshelf.y)
  add(bank.roundTable(), FACILITIES.loungeRoundTable.x, FACILITIES.loungeRoundTable.y)

  // 办公区上部（老板位旁）填充
  add(bank.bookshelf(), FACILITIES.officeBookshelf.x, FACILITIES.officeBookshelf.y)

  // 走廊饮水机
  add(bank.waterCooler(), FACILITIES.corridorCooler.x, FACILITIES.corridorCooler.y)

  // 老板办公室（会议室正下方）：大班台/老板椅/显示器/老板本尊由场景层绘制（有动态层级与帧切换）
  add(bank.bookshelf(), FACILITIES.bossOffice.bookshelf.x, FACILITIES.bossOffice.bookshelf.y)
  add(bank.plant(true), FACILITIES.bossOffice.plant.x, FACILITIES.bossOffice.plant.y)

  // 散落绿植
  for (const p of FACILITIES.plants) add(bank.plant(true), p.x, p.y)

  world.addChild(room)
}
