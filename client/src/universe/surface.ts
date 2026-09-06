/**
 * Procedural planet surfaces.
 *
 * A planet is an equirectangular texture (TW×TH) generated once from its seed
 * (and regenerated when vegetation changes noticeably). Each frame the sphere
 * renderer projects it onto a disc of any diameter with 3-level pixel shading
 * lit from the direction of the central star.
 */
import { makeNoise, mulberry32, clamp01, TAU } from './prng'
import { palettePick, mix, type PlanetPalette, type RGB } from './palette'

export const TW = 144
export const TH = 72

export interface Surface {
  palette: PlanetPalette
  /** RGB per texel */
  tex: Uint8ClampedArray
  /** 0/1 per texel for clouds (with own texture width) */
  clouds: Uint8Array
  /** 0..1 height per texel */
  height: Float32Array
  vegetation: number
  rings: boolean
  ringColor: RGB
  ringTilt: number
  moons: { dist: number; size: number; speed: number; phase: number; color: RGB }[]
}

export function generateSurface(seed: number, vegetation: number): Surface {
  const palette = palettePick(seed)
  const rng = mulberry32(seed)
  const n1 = makeNoise(seed + 1, 6)
  const n2 = makeNoise(seed + 2, 12)
  const n3 = makeNoise(seed + 3, 24)
  const nv = makeNoise(seed + 4, 9)
  const tex = new Uint8ClampedArray(TW * TH * 3)
  const height = new Float32Array(TW * TH)
  const veg = clamp01(vegetation)
  for (let y = 0; y < TH; y++) {
    const lat = (y / TH - 0.5) * Math.PI
    for (let x = 0; x < TW; x++) {
      const u = (x / TW) * 6
      const v = (y / TH) * 6
      let h = n1(u, v) * 0.55 + n2(u * 2, v * 2) * 0.3 + n3(u * 4, v * 4) * 0.15
      height[y * TW + x] = h
      let c: RGB
      const polar = Math.abs(lat) / (Math.PI / 2)
      if (h < palette.seaLevel) {
        c = h < palette.seaLevel - 0.12 ? palette.waterDeep : palette.water
      } else {
        const rel = (h - palette.seaLevel) / (1 - palette.seaLevel)
        c = rel > 0.6 ? palette.mountain : rel > 0.3 ? palette.landHigh : palette.land
        // vegetation creeps over lowland as the world grows
        const vegNoise = nv(u * 1.5, v * 1.5)
        if (rel < 0.6 && vegNoise < veg * 0.9 + 0.05 && veg > 0.02) {
          c = mix(c, palette.veg, clamp01(0.4 + veg * 0.6))
        }
      }
      if (palette.hasIceCaps && polar > 0.78 + n2(u, v) * 0.1) c = palette.ice
      const i = (y * TW + x) * 3
      tex[i] = c[0]
      tex[i + 1] = c[1]
      tex[i + 2] = c[2]
    }
  }
  const cn = makeNoise(seed + 9, 8)
  const clouds = new Uint8Array(TW * TH)
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const val = cn((x / TW) * 8, (y / TH) * 8) * 0.6 + cn((x / TW) * 16 + 3, (y / TH) * 16) * 0.4
    clouds[y * TW + x] = val > 1 - palette.cloudiness * 0.55 ? 1 : 0
  }
  const rings = rng() < 0.22
  const moonCount = rng() < 0.5 ? 0 : rng() < 0.7 ? 1 : 2
  const moons = Array.from({ length: moonCount }, () => ({
    dist: 1.5 + rng() * 0.6,
    size: 0.12 + rng() * 0.1,
    speed: (0.15 + rng() * 0.2) * (rng() < 0.5 ? 1 : -1),
    phase: rng() * TAU,
    color: mix([200, 200, 210], palette.land, rng() * 0.5) as RGB,
  }))
  return { palette, tex, clouds, height, vegetation: veg, rings, ringColor: mix(palette.atmosphere, [255, 240, 220], 0.4), ringTilt: 0.25 + rng() * 0.2, moons }
}

/**
 * Renders the sphere into `img` (diameter D). `rot` in radians, light = unit
 * vector toward the star in view space (x right, y up, z toward viewer).
 */
export function renderSphere(
  img: ImageData,
  s: Surface,
  D: number,
  rot: number,
  cloudRot: number,
  light: [number, number, number],
  energy: number,
  damage: number,
  time: number,
) {
  const data = img.data
  const R = D / 2
  const pal = s.palette
  const nightR = pal.night[0], nightG = pal.night[1], nightB = pal.night[2]
  const lx = light[0], ly = light[1], lz = light[2]
  const showClouds = pal.cloudiness > 0.05
  for (let py = 0; py < D; py++) {
    const ny = -((py + 0.5) / R - 1)
    for (let px = 0; px < D; px++) {
      const nx = (px + 0.5) / R - 1
      const i = (py * D + px) * 4
      const rr = nx * nx + ny * ny
      if (rr > 1) {
        data[i + 3] = 0
        continue
      }
      const nz = Math.sqrt(1 - rr)
      const lat = Math.asin(ny)
      const lon = Math.atan2(nx, nz)
      const tx = (((lon + rot) / TAU) * TW + TW * 10) % TW | 0
      const ty = Math.min(TH - 1, ((lat / Math.PI + 0.5) * TH) | 0)
      const ti = (ty * TW + tx) * 3
      let r = s.tex[ti], g = s.tex[ti + 1], b = s.tex[ti + 2]
      if (showClouds) {
        const cx = (((lon + cloudRot) / TAU) * TW + TW * 10) % TW | 0
        if (s.clouds[ty * TW + cx]) {
          r = r * 0.35 + pal.cloud[0] * 0.65
          g = g * 0.35 + pal.cloud[1] * 0.65
          b = b * 0.35 + pal.cloud[2] * 0.65
        }
      }
      // damage: dark scorched patches drift over the world
      if (damage > 0.05) {
        const dmg = ((tx * 7 + ty * 13) % 17) / 17
        if (dmg < damage * 0.6) {
          r *= 0.55
          g *= 0.5
          b *= 0.5
        }
      }
      const dot = nx * lx + ny * ly + nz * lz
      // three-band pixel shading, plus a rim highlight on the lit edge
      let k: number
      if (dot > 0.35) k = 1
      else if (dot > 0.05) k = 0.72
      else if (dot > -0.12) k = 0.42
      else k = 0
      if (k === 0) {
        // night side: deep tint, tiny twinkling city glow proportional to energy
        const glow = energy > 0.05 && ((tx * 31 + ty * 17 + ((time * 2) | 0)) % 23) < energy * 5 ? 1 : 0
        r = nightR + (r - nightR) * 0.18 + glow * pal.light[0] * 0.6
        g = nightG + (g - nightG) * 0.18 + glow * pal.light[1] * 0.6
        b = nightB + (b - nightB) * 0.18 + glow * pal.light[2] * 0.6
      } else {
        r *= k
        g *= k
        b *= k
        if (rr > 0.86 && dot > 0.3) {
          r = r * 0.8 + 255 * 0.2
          g = g * 0.8 + 255 * 0.2
          b = b * 0.8 + 255 * 0.2
        }
      }
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
}
