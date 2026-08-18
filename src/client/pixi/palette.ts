/** 物种：牛 / 马 */
export type Species = 'ox' | 'horse'

export interface CharacterPalette {
  body: string
  bodyDark: string
  muzzle: string
  accent: string
}

/** 4 套牛配色 + 4 套马配色，按 session id 哈希分配 */
const OX_PALETTES: CharacterPalette[] = [
  { body: '#F2E7D5', bodyDark: '#DECDB2', muzzle: '#F7D7CE', accent: '#D98E68' },
  { body: '#C99A6E', bodyDark: '#B4835B', muzzle: '#EFC9AC', accent: '#8A5F3C' },
  { body: '#9FB2BE', bodyDark: '#8AA0AE', muzzle: '#D8E2E8', accent: '#64798A' },
  { body: '#E8C7C0', bodyDark: '#D5AEA6', muzzle: '#F7E0D8', accent: '#B3705F' },
]

const HORSE_PALETTES: CharacterPalette[] = [
  { body: '#D9A566', bodyDark: '#C08D4F', muzzle: '#F0DCC0', accent: '#6E4F33' },
  { body: '#AB7B54', bodyDark: '#96683F', muzzle: '#DCC2A4', accent: '#5E4026' },
  { body: '#EDE0C8', bodyDark: '#DACBA9', muzzle: '#F7EFE0', accent: '#B08A5E' },
  { body: '#B7715C', bodyDark: '#9E5C48', muzzle: '#EAC7B8', accent: '#734139' },
]

export interface CharacterLook {
  species: Species
  palette: CharacterPalette
  /** 马：围巾色；牛：铃铛色 */
  ornament: string
  glasses: boolean
}

export function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 以字符串为种子的确定性伪随机序列（同一 id 每次刷新行为一致） */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ORNAMENT_COLORS = ['#E06C5B', '#5B9E7D', '#5B87C4', '#C4865B', '#8A6FB4', '#4FA9A0']

/** 总监专属金色系配色 */
const BOSS_PALETTE: CharacterPalette = {
  body: '#F7D98A',
  bodyDark: '#E3B85E',
  muzzle: '#FBE7C0',
  accent: '#C9962E',
}

/** 老板（用户）专属：深棕正装 + 金饰，区别于总监的金身 */
const OWNER_PALETTE: CharacterPalette = {
  body: '#6E5138',
  bodyDark: '#573F2A',
  muzzle: '#EFC9AC',
  accent: '#D4A017',
}

/** 老板（用户）固定形象：深棕牛皮 + 金饰 + 眼镜；不按 id 哈希，全办公室唯一 */
export function ownerLook(): CharacterLook {
  return { species: 'ox', palette: OWNER_PALETTE, ornament: '#D4A017', glasses: true }
}

/** 由 session id 稳定决定一个员工的形象；总监（root）使用专属金色系 + 工头帽 */
export function lookFor(id: string, boss = false): CharacterLook {
  const h = hashString(id)
  const species: Species = (h & 1) === 0 ? 'ox' : 'horse'
  if (boss) {
    return {
      species,
      palette: BOSS_PALETTE,
      ornament: '#D4A017',
      glasses: ((h >>> 14) & 7) === 0,
    }
  }
  const palette = (species === 'ox' ? OX_PALETTES : HORSE_PALETTES)[(h >>> 3) & 3]
  return {
    species,
    palette,
    ornament: ORNAMENT_COLORS[(h >>> 8) % ORNAMENT_COLORS.length],
    glasses: ((h >>> 14) & 7) === 0,
  }
}
