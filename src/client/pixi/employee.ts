import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import { mulberry32, hashString, lookFor, type CharacterLook } from './palette.ts'
import type { CharacterFrames, TextureBank } from './textures.ts'
import type { DeskSlot } from './officeLayout.ts'

export type EmployeeStatus = 'working' | 'idle'

export interface EmployeeInfo {
  id: string
  label: string
  status: EmployeeStatus
  /** 根会话（总监位）；子 agent false */
  root: boolean
  detail?: string
  /** 有待用户拍板的交互（审批/提问）：头顶周期冒泡提醒 */
  pending?: boolean
}

const WALK_SPEED = 95
/** 气泡最小间隔（秒）：多 agent 高频输出时避免 Text 反复重建 */
const SAY_MIN_GAP = 1.2

/**
 * 单个员工：坐在自己的工位或在场内走动。状态由外部（场景）设置，
 * 本类只负责表现（帧动画、移动、气泡、屏幕辉光归属工位）。
 */
export class Employee {
  readonly id: string
  look: CharacterLook
  readonly container = new Container()
  private readonly body: Sprite
  private readonly bubble = new Container()
  private readonly bubbleBg = new Graphics()
  private bubbleText: Text | undefined
  private bubbleHideAt = 0

  private frames: CharacterFrames
  private anim = 'sit'
  private animFrame = 0
  private animTimer = 0

  // 气泡节流：多 agent 高频输出时防止 Text 反复重建
  private age = 0
  private lastSayAt = -Infinity

  private path: Array<{ x: number; y: number }> = []
  private segIndex = 0
  private segFrom = { x: 0, y: 0 }
  private segTarget: { x: number; y: number } | undefined
  private segElapsed = 0
  private segDuration = 0

  slot: DeskSlot | undefined
  atDesk = true

  private readonly rand: () => number

  constructor(id: string, bank: TextureBank, boss = false, look: CharacterLook = lookFor(id, boss)) {
    this.id = id
    this.look = look
    this.rand = mulberry32(hashString(id) ^ 0x9e3779b9)
    this.frames = bank.characterFrames(look, boss)
    this.body = new Sprite(this.frames.sit)
    this.body.anchor.set(44 / 88, 100 / 104)
    this.container.addChild(this.body)
    this.bubble.addChild(this.bubbleBg)
    this.bubble.visible = false
    this.container.addChild(this.bubble)
    this.container.eventMode = 'static'
    this.container.hitArea = { contains: (x: number, y: number) => Math.abs(x) < 34 && y > -104 && y < 4 }
  }

  /** 晋升/降级（root 变化）时换外观与帧组，并立即刷新当前姿势帧 */
  relook(bank: TextureBank, boss: boolean): void {
    this.look = lookFor(this.id, boss)
    this.frames = bank.characterFrames(this.look, boss)
    this.applyFrame()
  }

  say(text: string, seconds = 3): void {
    if (this.age - this.lastSayAt < SAY_MIN_GAP) return
    this.lastSayAt = this.age
    if (this.bubbleText !== undefined) {
      this.bubbleText.destroy()
      this.bubbleText = undefined
    }
    const t = new Text({
      text,
      style: { fill: '#4A4034', fontSize: 13, fontFamily: 'system-ui, "Microsoft YaHei", sans-serif', wordWrap: true, wordWrapWidth: 150, breakWords: true },
    })
    t.anchor.set(0.5)
    const w = Math.min(158, t.width + 18)
    const h = t.height + 12
    this.bubbleBg.clear()
    this.bubbleBg.roundRect(-w / 2, -h, w, h, 8).fill({ color: '#FFFFFF', alpha: 0.94 })
    this.bubbleBg.poly([-5, -1, 5, -1, 0, 9]).fill({ color: '#FFFFFF', alpha: 0.94 })
    this.bubbleBg.roundRect(-w / 2, -h, w, h, 8).stroke({ width: 1, color: '#D9CDB8' })
    this.bubbleBg.position.set(0, -60)
    t.position.set(0, -60 - h / 2)
    this.bubbleText = t
    this.bubble.addChild(t)
    this.bubble.visible = true
    this.bubbleHideAt = seconds
  }

  sitAt(slot: DeskSlot, immediately: boolean): void {
    this.slot = slot
    if (immediately) {
      this.container.position.set(slot.x, slot.y - 14)
      this.atDesk = true
      this.path = []
      this.segTarget = undefined
    }
  }

  /** 沿路径点序列行走（场景经寻路生成，避免穿过家具） */
  startWalkPath(points: Array<{ x: number; y: number }>): void {
    if (points.length === 0) return
    this.path = points
    this.segIndex = 0
    this.atDesk = false
    this.beginSegment()
  }

  startWalkTo(target: { x: number; y: number }): void {
    this.startWalkPath([target])
  }

  private beginSegment(): void {
    const target = this.path[this.segIndex]
    if (target === undefined) {
      this.path = []
      this.segTarget = undefined
      return
    }
    this.segFrom = { x: this.container.x, y: this.container.y }
    this.segTarget = target
    this.segElapsed = 0
    const dist = Math.hypot(target.x - this.segFrom.x, target.y - this.segFrom.y)
    this.segDuration = Math.max(0.08, dist / WALK_SPEED)
    if (Math.abs(target.x - this.segFrom.x) > 4) this.body.scale.x = target.x > this.segFrom.x ? 1 : -1
  }

  isWalking(): boolean { return this.path.length > 0 }

  /** 强制切换表现帧组：sit / type / stand / walk / sleep / raise */
  pose(name: string): void {
    if (this.anim === name) return
    this.anim = name
    this.animFrame = 0
    this.animTimer = 0
    this.applyFrame()
  }

  private applyFrame(): void {
    let tex: Texture
    if (this.anim === 'walk') tex = this.frames.walk[this.animFrame % 2]
    else if (this.anim === 'type') tex = this.frames.type[this.animFrame % 2]
    else if (this.anim === 'sleep') tex = this.frames.sleep
    else if (this.anim === 'raise') tex = this.frames.raise
    else if (this.anim === 'stand') tex = this.frames.stand
    else tex = this.frames.sit
    this.body.texture = tex
  }

  update(dt: number): 'arrived' | undefined {
    this.age += dt
    // 帧动画计时
    this.animTimer += dt
    if (this.animTimer > 0.22) {
      this.animTimer = 0
      if (this.anim === 'walk' || this.anim === 'type') {
        this.animFrame++
        this.applyFrame()
      }
    }
    // 气泡倒计时
    if (this.bubble.visible && this.bubbleHideAt > 0) {
      this.bubbleHideAt -= dt
      if (this.bubbleHideAt <= 0) this.bubble.visible = false
    }
    // 路径推进：逐段匀速行走
    if (this.path.length > 0 && this.segTarget !== undefined) {
      this.segElapsed += dt
      const k = Math.min(1, this.segElapsed / this.segDuration)
      this.container.x = this.segFrom.x + (this.segTarget.x - this.segFrom.x) * k
      this.container.y = this.segFrom.y + (this.segTarget.y - this.segFrom.y) * k
      if (k >= 1) {
        this.segIndex++
        if (this.segIndex >= this.path.length) {
          this.path = []
          this.segTarget = undefined
          this.body.scale.x = 1
          return 'arrived'
        }
        this.beginSegment()
      }
    }
    return undefined
  }

  set alphaVisible(v: boolean) { this.container.visible = v }

  destroy(): void {
    this.container.destroy({ children: true })
  }
}
