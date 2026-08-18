import { Container, Graphics, Sprite, Text, Texture, type Renderer } from 'pixi.js'

const FONT = 'system-ui, "Microsoft YaHei", sans-serif'

interface Particle {
  sprite: Sprite | Text
  vx: number
  vy: number
  life: number
  maxLife: number
  grow: number
}

/** 简单粒子系统：咖啡蒸汽 / 睡觉 Zzz */
export class Particles {
  private readonly layer = new Container()
  private readonly items: Particle[] = []
  private readonly dot: Texture

  constructor(parent: Container, renderer: Renderer) {
    this.layer.zIndex = 8000
    parent.addChild(this.layer)
    const g = new Graphics()
    g.circle(8, 8, 7).fill('#FFFFFF')
    this.dot = renderer.generateTexture(g)
    g.destroy()
  }

  steam(x: number, y: number): void {
    const s = new Sprite(this.dot)
    s.anchor.set(0.5)
    s.position.set(x + (Math.random() - 0.5) * 10, y)
    s.scale.set(0.10 + Math.random() * 0.06)
    s.alpha = 0.30
    s.blendMode = 'screen'
    this.layer.addChild(s)
    this.items.push({ sprite: s, vx: (Math.random() - 0.5) * 4, vy: -14 - Math.random() * 8, life: 0, maxLife: 1.8, grow: 0.06 })
  }

  zzz(x: number, y: number): void {
    const t = new Text({ text: 'Z', style: { fill: '#7A9BC0', fontSize: 16, fontFamily: FONT, fontWeight: '700' } })
    t.anchor.set(0.5)
    t.position.set(x, y)
    t.alpha = 0.9
    this.layer.addChild(t)
    this.items.push({ sprite: t, vx: 6, vy: -16, life: 0, maxLife: 2.2, grow: 0.04 })
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]
      p.life += dt
      const k = p.life / p.maxLife
      if (k >= 1) {
        p.sprite.destroy()
        this.items.splice(i, 1)
        continue
      }
      p.vy += 60 * dt * (p.grow === 0 ? 1 : -0.1)
      p.sprite.x += p.vx * dt
      p.sprite.y += p.vy * dt
      p.sprite.rotation += dt * (p.grow === 0 ? 4 : 0)
      if (p.grow > 0) p.sprite.scale.set(p.sprite.scale.x + p.grow * dt)
      p.sprite.alpha = p.grow > 0 ? 0.9 * (1 - k) * (k < 0.15 ? k / 0.15 : 1) : 1 - k
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true })
  }
}
