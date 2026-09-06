/**
 * Tiny pixel sprites, defined as text. Legend:
 *  . transparent   w wall     r roof     l window/light (glows at night)
 *  d dark          m metal    g leaf     t trunk    x accent    c crystal
 *  f flame         o outline
 */
import type { StructureKind } from '@shared/types'

export type Sprite = string[]

export const STRUCTURES: Record<StructureKind, Sprite> = {
  hut: ['.r.', 'rrr', 'wlw'],
  tower: ['.l.', '.w.', 'wlw', 'wlw', 'wlw'],
  dome: ['.mm.', 'mllm', 'mmmm'],
  factory: ['x..x', 'x..x', 'wwww', 'wlwl'],
  antenna: ['x...', '.x..', '.mm.', '.mm.'],
  lab: ['.ll.', 'lmml', 'mmmm', 'wllw'],
  monument: ['..x..', '..w..', '.www.', 'wwlww'],
  tree: ['.g.', 'ggg', 'ggg', '.t.'],
  crystal: ['.c.', 'ccc', '.c.', 'ccc'],
  beacon: ['.x.', '.l.', '.m.', 'mmm'],
}

export const SHIPS = {
  shuttle: ['..m..', '.mlm.', 'mmmmm', 'f...f'],
  rocket: ['.m.', 'mlm', 'mmm', 'xmx', '.f.'],
  ufo: ['.lll.', 'mmmmm', '.x.x.'],
  scout: ['mlm', '.f.'],
  probe: ['x', 'm'],
}

export const CREATURES = {
  blob: ['ll', 'll'],
  walker: ['l', 'd'],
}

export type ColorMap = Record<string, string | null>

export function drawSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number, px: number, colors: ColorMap) {
  for (let row = 0; row < sprite.length; row++) {
    const line = sprite[row]
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]
      if (ch === '.') continue
      const c = colors[ch]
      if (!c) continue
      ctx.fillStyle = c
      ctx.fillRect(Math.round(x + col * px), Math.round(y + row * px), Math.ceil(px), Math.ceil(px))
    }
  }
}

export const spriteSize = (s: Sprite) => ({ w: Math.max(...s.map((l) => l.length)), h: s.length })
