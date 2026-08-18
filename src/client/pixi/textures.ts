import { Graphics, Texture, type Renderer } from 'pixi.js'
import type { CharacterLook } from './palette.ts'

/**
 * 场景纹理库：所有家具/角色帧都用 Graphics 代码绘制后经 generateTexture
 * 固化成纹理（画一次、到处复用）。缓存随场景实例走，场景销毁时统一释放。
 */
export class TextureBank {
  private readonly cache = new Map<string, Texture>()

  constructor(private readonly renderer: Renderer) {}

  private texture(key: string, w: number, h: number, draw: (g: Graphics) => void): Texture {
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const g = new Graphics()
    draw(g)
    const tex = this.renderer.generateTexture(g)
    g.destroy()
    this.cache.set(key, tex)
    return tex
  }

  destroy(): void {
    for (const tex of this.cache.values()) tex.destroy(true)
    this.cache.clear()
  }

  // ---------- 家具 ----------

  desk(boss: boolean): Texture {
    const w = boss ? 196 : 140
    const topH = boss ? 26 : 24
    return this.texture(`desk:${boss}`, w + 8, 74, g => {
      // 桌腿
      g.roundRect(8, topH + 4, 9, 42, 2).fill('#8A6238')
      g.roundRect(w - 9, topH + 4, 9, 42, 2).fill('#8A6238')
      // 桌面（带厚度与高光）
      g.roundRect(2, 8, w + 4, topH, 7).fill(boss ? '#8F6B44' : '#C89B6B')
      g.roundRect(2, 8, w + 4, topH, 7).stroke({ width: 1, color: boss ? '#6B4D2A' : '#9E7442', alpha: 0.6 })
      g.roundRect(4, 10, w, 7, 5).fill(boss ? '#9E784E' : '#D4A87A', 0.55)
      g.rect(2, 8 + topH - 4, w + 4, 4).fill(boss ? '#77562F' : '#A87947')
      // 键盘
      g.roundRect(w / 2 - 27, 12, 54, 11, 2).fill('#E8E3D8')
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 9; kx++) {
          g.rect(w / 2 - 24 + kx * 5.6, 14 + ky * 3, 4, 2).fill('#C8C2B4')
        }
      }
      // 咖啡杯
      g.circle(26, 18, 5.5).fill('#D9714E')
      g.circle(26, 18, 5.5).stroke({ width: 2, color: '#B5553A' })
      g.ellipse(26, 16, 4, 1.6).fill('#6E4A33')
      if (boss) {
        g.roundRect(w - 46, 12, 26, 12, 2).fill('#4A4F57')
        g.rect(w - 42, 14, 18, 3).fill('#7CE08A', 0.7)
      }
    })
  }

  /** 简易木椅（会议室/茶水间用） */
  chair(): Texture {
    return this.texture('chair', 48, 18, g => {
      g.roundRect(2, 2, 44, 11, 5).fill('#7C8894')
      g.roundRect(2, 2, 44, 11, 5).stroke({ width: 1, color: '#66707B', alpha: 0.7 })
      g.rect(21, 13, 6, 4).fill('#59626C')
    })
  }

  /** 员工办公椅（高靠背 + 五爪底盘）；靠背足够高，坐下后能挡住后背、露出后脑勺 */
  officeChair(): Texture {
    return this.texture('officeChair', 64, 84, g => {
      g.poly([32, 62, 8, 76, 20, 78]).fill('#4A5058')
      g.poly([32, 62, 56, 76, 44, 78]).fill('#4A5058')
      g.poly([32, 62, 30, 78, 34, 78]).fill('#4A5058')
      g.circle(10, 76, 3.4).fill('#3E434A')
      g.circle(54, 76, 3.4).fill('#3E434A')
      g.circle(32, 77, 3.4).fill('#3E434A')
      g.rect(29.5, 50, 5, 14).fill('#55595F')
      g.roundRect(11, 44, 42, 11, 5).fill('#4A5058')
      g.roundRect(12, 8, 40, 44, 10).fill('#5A6472')
      g.roundRect(12, 8, 40, 44, 10).stroke({ width: 1.2, color: '#434B56' })
      g.roundRect(18, 32, 28, 6, 3).fill('#4E5763')
      g.roundRect(16, 12, 32, 10, 6).fill('#66707E', 0.6)
    })
  }

  /** 老板大班椅：比员工椅更宽更高的深棕高背 + 金色滚边与脚轮 */
  bossChair(): Texture {
    return this.texture('bossChair', 72, 96, g => {
      g.poly([36, 78, 10, 90, 24, 92]).fill('#8A6A2A')
      g.poly([36, 78, 62, 90, 48, 92]).fill('#8A6A2A')
      g.poly([36, 78, 33, 92, 39, 92]).fill('#8A6A2A')
      g.circle(12, 90, 3.6).fill('#6E521F')
      g.circle(60, 90, 3.6).fill('#6E521F')
      g.circle(36, 91, 3.6).fill('#6E521F')
      g.rect(33, 64, 6, 16).fill('#7A5C22')
      g.roundRect(8, 58, 56, 12, 6).fill('#5C4633')
      g.roundRect(8, 6, 56, 56, 12).fill('#6E5138')
      g.roundRect(8, 6, 56, 56, 12).stroke({ width: 1.6, color: '#D4A017', alpha: 0.8 })
      g.roundRect(18, 12, 36, 14, 7).fill('#7A5C40')
      g.roundRect(16, 34, 40, 7, 3.5).fill('#5C4633')
    })
  }

  /** 老板皇冠（金色三尖冠 + 红宝石），叠在老板头顶 */
  bossCrown(): Texture {
    return this.texture('bossCrown', 40, 22, g => {
      g.poly([5, 20, 3, 5, 13, 13, 20, 2, 27, 13, 37, 5, 35, 20]).fill('#F0C24B')
      g.poly([5, 20, 3, 5, 13, 13, 20, 2, 27, 13, 37, 5, 35, 20]).stroke({ width: 1.2, color: '#B58A1E' })
      g.rect(3, 17, 34, 4).fill('#D4A017')
      g.circle(20, 9, 2.4).fill('#C0492F')
    })
  }

  /** 显示器关机（屏幕朝向观众） */
  monitorOff(): Texture {
    return this.texture('monitor:off', 84, 92, g => {
      drawMonitorShell(g)
      g.roundRect(7, 7, 70, 32, 3).fill('#22262D')
      g.poly([12, 37, 34, 9, 44, 9, 22, 37]).fill('#3A4450', 0.5)
      g.circle(76, 34, 2.2).fill('#8A4A42')
    })
  }

  /** 显示器工作帧 x3：屏幕上代码行循环上移形成滚动动画 */
  monitorFrames(): Texture[] {
    const rows = [
      { w: 34, c: '#8FC7F0' },
      { w: 48, c: '#7CE08A' },
      { w: 22, c: '#D9A06B' },
      { w: 40, c: '#8FC7F0' },
      { w: 30, c: '#C79BE8' },
      { w: 52, c: '#7CE08A' },
    ]
    return [0, 1, 2].map(i => this.texture(`monitor:frame${i}`, 84, 92, g => {
      drawMonitorShell(g)
      g.roundRect(7, 7, 70, 32, 3).fill('#1B2735')
      g.roundRect(9, 9, 18, 5, 2).fill('#7FB8E8')
      for (let r = 0; r < 4; r++) {
        const row = rows[(r + i) % rows.length]
        g.roundRect(11, 17 + r * 5.6, row.w, 3, 1.5).fill(row.c)
      }
      g.circle(76, 34, 2.2).fill('#7CE08A')
    }))
  }

  coffeeMachine(): Texture {
    return this.texture('coffee', 44, 68, g => {
      g.roundRect(2, 2, 40, 46, 6).fill('#5A6472')
      g.roundRect(8, 8, 28, 10, 4).fill('#434B56')
      g.circle(22, 34, 6).fill('#2E343C')
      g.roundRect(16, 38, 12, 10, 2).fill('#E8B84B')
      g.rect(4, 48, 36, 16).fill('#49525E')
      g.roundRect(2, 2, 40, 64, 6).stroke({ width: 1.5, color: '#39414C' })
    })
  }

  waterCooler(): Texture {
    return this.texture('cooler', 40, 76, g => {
      g.ellipse(20, 14, 12, 13).fill('#A8CCE2')
      g.ellipse(16, 9, 4, 6).fill('#D6ECF8', 0.8)
      g.roundRect(6, 26, 28, 22, 4).fill('#DDE6EC')
      g.circle(13, 42, 3).fill('#5B87C4')
      g.circle(27, 42, 3).fill('#D9714E')
      g.rect(12, 48, 16, 24).fill('#C4CFD8')
    })
  }

  plant(big: boolean): Texture {
    const s = big ? 1.25 : 1
    return this.texture(`plant:${big}`, Math.round(64 * s), Math.round(84 * s), g => {
      const cx = 32 * s
      const leaf = (dx: number, dy: number, r: number, color: string) => {
        g.circle(cx + dx * s, dy * s, r * s).fill(color)
      }
      leaf(-12, 34, 11, '#6FA97C')
      leaf(12, 34, 11, '#6FA97C')
      leaf(0, 26, 13, '#8CBE98')
      leaf(-6, 18, 9, '#7AB289')
      leaf(7, 20, 10, '#8CBE98')
      g.poly([cx - 14 * s, 46 * s, cx + 14 * s, 46 * s, cx + 10 * s, 66 * s, cx - 10 * s, 66 * s]).fill('#C96F4A')
      g.roundRect(cx - 16 * s, 44 * s, 32 * s, 7 * s, 3).fill('#B25E3C')
    })
  }

  door(): Texture {
    return this.texture('door', 74, 124, g => {
      g.roundRect(2, 2, 70, 120, 6).fill('#96683F')
      g.roundRect(8, 8, 58, 114, 5).fill('#B5835A')
      g.roundRect(18, 16, 38, 34, 4).fill('#CFE4F2')
      g.circle(58, 72, 3.5).fill('#4A3A28')
    })
  }

  punchClock(): Texture {
    return this.texture('punch', 38, 50, g => {
      g.roundRect(2, 2, 34, 46, 6).fill('#D9714E')
      g.roundRect(6, 8, 26, 12, 3).fill('#8A3E26')
      g.roundRect(10, 28, 18, 8, 3).fill('#F7E6D8')
      g.circle(19, 42, 3).fill('#8CE0B0')
    })
  }

  window(): Texture {
    return this.texture('window', 116, 74, g => {
      g.roundRect(2, 2, 112, 70, 8).fill('#F0EAD9')
      g.roundRect(9, 9, 98, 56, 4).fill('#CFE4F2')
      g.circle(34, 26, 9).fill('#FFFFFF', 0.85)
      g.circle(44, 30, 12).fill('#FFFFFF', 0.7)
      g.circle(78, 44, 8).fill('#FFFFFF', 0.6)
      g.rect(57, 9, 3, 56).fill('#F0EAD9')
      g.rect(9, 35, 98, 3).fill('#F0EAD9')
    })
  }

  wallClock(): Texture {
    return this.texture('wallclock', 48, 48, g => {
      g.circle(24, 24, 21).fill('#F7F3EB')
      g.circle(24, 24, 21).stroke({ width: 3, color: '#6A6156' })
      g.rect(23, 10, 2, 15).fill('#4A433B')
      g.rect(24, 23, 11, 2).fill('#4A433B')
      g.circle(24, 24, 2).fill('#D9714E')
    })
  }

  /** 径向光晕（canvas 2D 渐变生成）：屏幕辉光 / 灯光 */
  glow(color: string, size = 128): Texture {
    const key = `glow:${color}:${size}`
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx !== null) {
      const half = size / 2
      const grad = ctx.createRadialGradient(half, half, 0, half, half, half)
      grad.addColorStop(0, color)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, size, size)
    }
    const tex = Texture.from(canvas)
    this.cache.set(key, tex)
    return tex
  }

  // ---------- 功能分区家具 ----------

  /** 茶水间吧台（带水槽和烧水壶） */
  counter(): Texture {
    return this.texture('counter', 252, 52, g => {
      g.roundRect(4, 14, 244, 34, 6).fill('#B5885B')
      g.roundRect(0, 4, 252, 16, 7).fill('#D4A87A')
      g.roundRect(0, 4, 252, 16, 7).stroke({ width: 1, color: '#9E7442', alpha: 0.7 })
      g.roundRect(140, 4, 84, 13, 4).fill('#8FA3AF')
      g.roundRect(146, 6, 72, 9, 3).fill('#728694')
      g.circle(66, 2, 8).fill('#5A6472')
      g.roundRect(60, -6, 12, 10, 3).fill('#5A6472')
    })
  }

  /** 茶水间小圆桌 */
  roundTable(): Texture {
    return this.texture('roundTable', 124, 64, g => {
      g.ellipse(62, 20, 58, 24).fill('#C89B6B')
      g.ellipse(62, 17, 58, 24).fill('#D4A87A')
      g.ellipse(62, 17, 58, 24).stroke({ width: 1.5, color: '#9E7442', alpha: 0.6 })
      g.rect(58, 24, 8, 32).fill('#8A6A45')
      g.ellipse(62, 58, 22, 7).fill('#8A6A45')
    })
  }

  /** 休息室三人沙发 */
  sofa(): Texture {
    return this.texture('sofa', 176, 92, g => {
      g.roundRect(6, 6, 164, 40, 14).fill('#B96A52')
      g.roundRect(0, 30, 176, 46, 12).fill('#C98A6E')
      g.roundRect(0, 18, 26, 58, 12).fill('#B96A52')
      g.roundRect(150, 18, 26, 58, 12).fill('#B96A52')
      g.roundRect(34, 44, 46, 26, 8).fill('#D6A184')
      g.roundRect(86, 44, 46, 26, 8).fill('#D6A184')
      g.rect(18, 76, 10, 8).fill('#7A4A36')
      g.rect(148, 76, 10, 8).fill('#7A4A36')
    })
  }

  /** 休息室茶几 */
  loungeTable(): Texture {
    return this.texture('loungeTable', 116, 56, g => {
      g.roundRect(4, 6, 108, 12, 6).fill('#A87947')
      g.roundRect(4, 6, 108, 12, 6).stroke({ width: 1, color: '#8A5F33', alpha: 0.7 })
      g.roundRect(12, 30, 92, 8, 4).fill('#8A5F33')
      g.rect(10, 16, 8, 36).fill('#7A5430')
      g.rect(98, 16, 8, 36).fill('#7A5430')
    })
  }

  /** 休息室电视柜+电视 */
  tv(): Texture {
    return this.texture('tv', 88, 118, g => {
      g.roundRect(10, 98, 68, 14, 4).fill('#8A6A45')
      g.roundRect(2, 2, 84, 52, 5).fill('#2A2F36')
      g.roundRect(6, 6, 76, 44, 3).fill('#364250')
      g.poly([14, 50, 40, 8, 52, 8, 26, 50]).fill('#4A5F78', 0.6)
      g.circle(44, 60, 2).fill('#7CE08A')
    })
  }

  /** 书架（三层彩色书脊） */
  bookshelf(): Texture {
    return this.texture('bookshelf', 140, 96, g => {
      g.roundRect(2, 2, 136, 92, 5).fill('#8F6B44')
      g.roundRect(2, 2, 136, 92, 5).stroke({ width: 2, color: '#6E4F2C' })
      const spines = ['#D9714E', '#5B87C4', '#5B9E7D', '#E8B84B', '#8A6FB4', '#4FA9A0']
      for (let shelf = 0; shelf < 3; shelf++) {
        const y = 8 + shelf * 30
        g.rect(8, y + 26, 124, 3).fill('#A87947')
        let x = 12
        let i = shelf * 2
        while (x < 122) {
          const w = 7 + ((i * 13) % 6)
          const h = 20 + ((i * 7) % 5)
          g.rect(x, y + 24 - h, w, h).fill(spines[i % spines.length])
          x += w + 2
          i++
        }
      }
    })
  }

  /** 会议室长桌（居中，四周留出环行走道） */
  meetingTable(): Texture {
    return this.texture('meetingTable', 244, 90, g => {
      g.roundRect(4, 32, 236, 46, 12).fill('#A87E4F')
      g.roundRect(4, 28, 236, 44, 12).fill('#B98F5E')
      g.roundRect(4, 28, 236, 44, 12).stroke({ width: 1.5, color: '#8A6238', alpha: 0.7 })
      g.roundRect(46, 38, 152, 20, 8).fill('#8A6238', 0.35)
      g.rect(20, 74, 14, 14).fill('#7A5430')
      g.rect(210, 74, 14, 14).fill('#7A5430')
      g.rect(108, 74, 28, 8).fill('#7A5430')
    })
  }

  /** 墙挂白板（带潦草的图表涂鸦） */
  whiteboard(): Texture {
    return this.texture('whiteboard', 184, 116, g => {
      g.roundRect(2, 2, 180, 112, 8).fill('#C8CDD4')
      g.roundRect(8, 8, 168, 100, 5).fill('#FBFBF9')
      g.roundRect(20, 24, 144, 60, 3).stroke({ width: 1.5, color: '#9AA6B4' })
      g.moveTo(28, 72).lineTo(58, 48).lineTo(88, 60).lineTo(122, 32).lineTo(152, 40)
      g.stroke({ width: 2.5, color: '#D9714E' })
      g.rect(34, 88, 26, 6).fill('#5B87C4')
      g.rect(66, 88, 26, 6).fill('#5B9E7D')
      g.rect(98, 88, 26, 6).fill('#E8B84B')
      g.circle(160, 20, 6).fill('#D9714E')
    })
  }

  // ---------- 角色 ----------

  /**
   * 角色帧。画布 88x104，脚底中心锚在 (44, 100)。
   * 帧集合：sit(坐姿被桌遮挡的上半身) / type x2(打字) / stand / walk x2 /
   * sleep(趴桌) / raise(举手) —— 眨眼等微动作由帧切换模拟。
   */
  characterFrames(look: CharacterLook, boss = false): CharacterFrames {
    const key = `${look.species}:${look.palette.body}:${look.ornament}:${look.glasses ? 1 : 0}:${boss ? 1 : 0}`
    const build = (state: string, frame: number): Texture =>
      this.texture(`char:${key}:${state}:${frame}`, 88, 104, g => {
        drawCharacter(g, look, state, frame, boss)
      })
    return {
      sit: build('sitBack', 0),
      type: [build('typeBack', 0), build('typeBack', 1)],
      stand: build('stand', 0),
      walk: [build('walk', 0), build('walk', 1)],
      sleep: build('sleepBack', 0),
      raise: build('raiseBack', 0),
    }
  }
}

export interface CharacterFrames {
  sit: Texture
  type: Texture[]
  stand: Texture
  walk: Texture[]
  sleep: Texture
  raise: Texture
}

const EYE = '#35281F'

function drawCharacter(g: Graphics, look: CharacterLook, state: string, frame: number, boss = false): void {
  if (state.endsWith('Back')) {
    drawCharacterBack(g, look, state, frame, boss)
    return
  }
  const p = look.palette
  const cx = 44
  const headY = 38
  const bob = state === 'type' && frame === 1 ? -1.5 : 0
  const hy = headY + bob

  const standing = state === 'stand' || state === 'walk' || state === 'raise'

  // 腿（站立系状态才画；坐姿被桌子挡住，省略）
  if (standing) {
    const stride = state === 'walk' ? (frame === 0 ? 3 : -3) : 0
    g.roundRect(cx - 9 + stride, 82, 7, 16, 3).fill(p.bodyDark)
    g.roundRect(cx + 2 - stride, 82, 7, 16, 3).fill(p.bodyDark)
    g.ellipse(cx - 5 + stride, 99, 5, 3).fill(p.accent)
    g.ellipse(cx + 5 - stride, 99, 5, 3).fill(p.accent)
  }

  // 身体
  if (state === 'sleep') {
    g.roundRect(cx - 14, 62, 28, 18, 8).fill(p.body)
  } else {
    g.roundRect(cx - 13, 58, 26, 30, 9).fill(p.body)
  }

  // 手臂
  if (state === 'type') {
    const up = frame === 0
    g.roundRect(cx - 17, up ? 58 : 62, 7, 12, 3).fill(p.body)
    g.roundRect(cx + 10, up ? 62 : 58, 7, 12, 3).fill(p.body)
  } else if (state === 'raise') {
    g.roundRect(cx - 17, 62, 7, 12, 3).fill(p.body)
    g.roundRect(cx + 12, 42, 7, 20, 3).fill(p.body)
    g.circle(cx + 15, 41, 4.5).fill(p.body)
  } else if (standing) {
    g.roundRect(cx - 18, 62, 7, 14, 3).fill(p.body)
    g.roundRect(cx + 11, 62, 7, 14, 3).fill(p.body)
  }

  // 物种特征（画在头后面）
  if (look.species === 'ox') {
    g.circle(cx - 18, hy - 16, 5.5).fill('#DFC08F')
    g.circle(cx + 18, hy - 16, 5.5).fill('#DFC08F')
    g.ellipse(cx - 21, hy + 1, 7, 4.5).fill(p.bodyDark)
    g.ellipse(cx + 21, hy + 1, 7, 4.5).fill(p.bodyDark)
    // 铃铛
    g.circle(cx, 66, 3.6).fill(look.ornament)
    g.rect(cx - 4, 61, 8, 3).fill(look.ornament)
  } else {
    g.circle(cx - 10, hy - 20, 6).fill(p.accent)
    g.circle(cx, hy - 23, 6.5).fill(p.accent)
    g.circle(cx + 10, hy - 20, 6).fill(p.accent)
    g.poly([cx - 14, hy - 12, cx - 9, hy - 24, cx - 5, hy - 12]).fill(p.bodyDark)
    g.poly([cx + 5, hy - 12, cx + 9, hy - 24, cx + 14, hy - 12]).fill(p.bodyDark)
    // 围巾
    g.roundRect(cx - 8, 57, 16, 7, 3.5).fill(look.ornament)
    g.roundRect(cx + 2, 62, 6, 12, 3).fill(look.ornament)
  }

  // 头
  g.circle(cx, hy, 20).fill(p.body)
  // 口鼻
  if (look.species === 'ox') {
    g.ellipse(cx, hy + 8, 11, 8).fill(p.muzzle)
    g.circle(cx - 4, hy + 8, 1.6).fill(p.bodyDark)
    g.circle(cx + 4, hy + 8, 1.6).fill(p.bodyDark)
  } else {
    g.ellipse(cx, hy + 9, 9, 10).fill(p.muzzle)
    g.circle(cx - 3, hy + 11, 1.5).fill(p.bodyDark)
    g.circle(cx + 3, hy + 11, 1.5).fill(p.bodyDark)
  }
  // 眼睛（睡觉画闭眼线）
  if (state === 'sleep') {
    g.roundRect(cx - 8, hy - 2, 6, 1.8, 1).fill(EYE)
    g.roundRect(cx + 2, hy - 2, 6, 1.8, 1).fill(EYE)
  } else if (state !== 'blink') {
    g.circle(cx - 7, hy - 3, 2.4).fill(EYE)
    g.circle(cx + 7, hy - 3, 2.4).fill(EYE)
  }
  // 腮红
  g.ellipse(cx - 13, hy + 5, 3.5, 2.2).fill('#E8A9A0', 0.45)
  g.ellipse(cx + 13, hy + 5, 3.5, 2.2).fill('#E8A9A0', 0.45)
  // 眼镜
  if (look.glasses && state !== 'sleep') {
    g.circle(cx - 7, hy - 3, 5.5).stroke({ width: 1.6, color: '#4A3F35' })
    g.circle(cx + 7, hy - 3, 5.5).stroke({ width: 1.6, color: '#4A3F35' })
    g.rect(cx - 2, hy - 4, 4, 1.4).fill('#4A3F35')
  }
  // 总监工头帽（橙色安全帽，画在头顶最上层）
  if (boss) {
    g.roundRect(cx - 16, hy - 27, 32, 5, 2.5).fill('#E8853A')
    g.roundRect(cx - 13, hy - 35, 26, 10, 5).fill('#F09547')
    g.roundRect(cx - 13, hy - 35, 26, 10, 5).stroke({ width: 1, color: '#B5601F' })
    g.rect(cx - 1.5, hy - 34, 3, 8).fill('#E8853A')
  }
}

/** 背对视角（坐姿系）：无脸，见耳朵/角/鬃毛/尾巴 */
function drawCharacterBack(g: Graphics, look: CharacterLook, state: string, frame: number, boss = false): void {
  const p = look.palette
  const cx = 44
  const hy = state === 'sleepBack' ? 50 : 38 + (state === 'typeBack' && frame === 1 ? -1.5 : 0)

  // 身体
  g.roundRect(cx - 13, 58, 26, 30, 9).fill(p.body)
  g.roundRect(cx - 13, 58, 26, 8, 9).fill(p.body, 0.9)

  // 尾巴（从背后看最显眼）
  if (look.species === 'ox') {
    g.roundRect(cx + 12, 72, 4, 13, 2).fill(p.bodyDark)
    g.circle(cx + 14, 86, 3.2).fill(p.accent)
  } else {
    g.roundRect(cx + 11, 60, 7, 27, 3.5).fill(p.accent)
  }

  // 举手（背对也能看到举起的手臂）
  if (state === 'raiseBack') {
    g.roundRect(cx + 13, 42, 6, 20, 3).fill(p.body)
    g.circle(cx + 16, 40, 4.5).fill(p.body)
  }

  // 物种背影特征
  if (look.species === 'ox') {
    g.circle(cx - 18, hy - 16, 5.5).fill('#DFC08F')
    g.circle(cx + 18, hy - 16, 5.5).fill('#DFC08F')
    g.poly([cx - 22, hy - 8, cx - 28, hy - 2, cx - 18, hy - 4]).fill(p.bodyDark)
    g.poly([cx + 22, hy - 8, cx + 28, hy - 2, cx + 18, hy - 4]).fill(p.bodyDark)
    g.ellipse(cx - 22, hy + 3, 8, 5).fill(p.bodyDark)
    g.ellipse(cx + 22, hy + 3, 8, 5).fill(p.bodyDark)
  } else {
    // 马鬃从背后是一条竖脊
    g.circle(cx - 8, hy - 17, 6).fill(p.accent)
    g.circle(cx + 8, hy - 17, 6).fill(p.accent)
    g.circle(cx, hy - 21, 6.5).fill(p.accent)
    g.roundRect(cx - 5, hy - 20, 10, 26, 5).fill(p.accent)
    g.poly([cx - 12, hy - 10, cx - 7, hy - 22, cx - 3, hy - 11]).fill(p.bodyDark)
    g.poly([cx + 3, hy - 11, cx + 7, hy - 22, cx + 12, hy - 10]).fill(p.bodyDark)
    // 围巾结
    g.circle(cx, 60, 3.2).fill(look.ornament)
  }

  // 后脑勺
  g.circle(cx, hy, 20).fill(p.body)
  g.ellipse(cx, hy + 11, 14, 8).fill(p.bodyDark, 0.22)
  // 总监工头帽（橙色安全帽，画在头顶最上层）
  if (boss) {
    g.roundRect(cx - 16, hy - 27, 32, 5, 2.5).fill('#E8853A')
    g.roundRect(cx - 13, hy - 35, 26, 10, 5).fill('#F09547')
    g.roundRect(cx - 13, hy - 35, 26, 10, 5).stroke({ width: 1, color: '#B5601F' })
    g.rect(cx - 1.5, hy - 34, 3, 8).fill('#E8853A')
  }
}

/** 显示器外壳：底座 + 支柱 + 面板框（画布 84x92，屏幕区 7,7,70,32） */
function drawMonitorShell(g: Graphics): void {
  g.roundRect(18, 84, 48, 6, 3).fill('#2E333B')
  g.rect(38, 46, 8, 40).fill('#343A42')
  g.roundRect(2, 2, 80, 44, 6).fill('#3A3F47')
  g.roundRect(2, 2, 80, 44, 6).stroke({ width: 1.2, color: '#2C3138' })
  g.circle(42, 41, 2.6).fill('#566069')
}
