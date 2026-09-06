export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 2D value noise that tiles horizontally with period `period` cells. */
export function makeNoise(seed: number, period: number) {
  const rng = mulberry32(seed)
  const size = 64
  const grid = new Float32Array(size * size)
  for (let i = 0; i < grid.length; i++) grid[i] = rng()
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return function noise(x: number, y: number): number {
    // x wraps every `period`
    const px = ((x % period) + period) % period
    const gx = (px / period) * size
    const x0 = Math.floor(gx) % size
    const x1 = (x0 + 1) % size
    const y0 = Math.floor(y) & (size - 1)
    const y1 = (y0 + 1) & (size - 1)
    const fx = smooth(gx - Math.floor(gx))
    const fy = smooth(y - Math.floor(y))
    const a = grid[y0 * size + x0]
    const b = grid[y0 * size + x1]
    const c = grid[y1 * size + x0]
    const d = grid[y1 * size + x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const clamp01 = (v: number) => clamp(v, 0, 1)
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutBack = (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2)
export const easeInCubic = (t: number) => t * t * t
export const TAU = Math.PI * 2
