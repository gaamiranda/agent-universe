import { mulberry32 } from './prng'

export type RGB = [number, number, number]

export interface PlanetPalette {
  kind: string
  water: RGB
  waterDeep: RGB
  land: RGB
  landHigh: RGB
  mountain: RGB
  ice: RGB
  veg: RGB
  atmosphere: RGB
  night: RGB
  light: RGB
  cloud: RGB
  /** 0..1 how much of the surface is water */
  seaLevel: number
  hasIceCaps: boolean
  cloudiness: number
}

const PALETTES: PlanetPalette[] = [
  { kind: 'terra', water: [58, 120, 190], waterDeep: [36, 78, 150], land: [176, 150, 92], landHigh: [200, 180, 120], mountain: [140, 118, 90], ice: [230, 240, 250], veg: [84, 160, 84], atmosphere: [120, 190, 255], night: [14, 22, 46], light: [255, 220, 130], cloud: [255, 255, 255], seaLevel: 0.52, hasIceCaps: true, cloudiness: 0.5 },
  { kind: 'dune', water: [190, 120, 70], waterDeep: [150, 90, 50], land: [230, 190, 110], landHigh: [245, 215, 140], mountain: [180, 130, 80], ice: [250, 240, 220], veg: [140, 170, 90], atmosphere: [255, 200, 140], night: [40, 22, 20], light: [255, 200, 120], cloud: [255, 235, 210], seaLevel: 0.25, hasIceCaps: false, cloudiness: 0.2 },
  { kind: 'frost', water: [90, 150, 210], waterDeep: [60, 110, 180], land: [200, 220, 240], landHigh: [240, 248, 255], mountain: [150, 170, 200], ice: [255, 255, 255], veg: [120, 190, 170], atmosphere: [190, 230, 255], night: [16, 24, 50], light: [190, 240, 255], cloud: [240, 250, 255], seaLevel: 0.45, hasIceCaps: true, cloudiness: 0.35 },
  { kind: 'toxic', water: [90, 170, 90], waterDeep: [50, 120, 70], land: [120, 100, 130], landHigh: [160, 140, 170], mountain: [90, 70, 100], ice: [200, 240, 200], veg: [200, 240, 90], atmosphere: [170, 255, 120], night: [16, 30, 20], light: [200, 255, 140], cloud: [220, 255, 200], seaLevel: 0.5, hasIceCaps: false, cloudiness: 0.6 },
  { kind: 'ember', water: [230, 90, 40], waterDeep: [180, 50, 20], land: [70, 50, 50], landHigh: [110, 80, 70], mountain: [50, 34, 34], ice: [120, 90, 90], veg: [200, 120, 60], atmosphere: [255, 140, 80], night: [30, 12, 12], light: [255, 160, 90], cloud: [90, 60, 60], seaLevel: 0.35, hasIceCaps: false, cloudiness: 0.3 },
  { kind: 'lavender', water: [110, 90, 200], waterDeep: [70, 60, 150], land: [220, 180, 230], landHigh: [245, 220, 250], mountain: [160, 120, 190], ice: [255, 245, 255], veg: [170, 110, 220], atmosphere: [220, 170, 255], night: [24, 14, 40], light: [255, 200, 255], cloud: [255, 240, 255], seaLevel: 0.5, hasIceCaps: true, cloudiness: 0.45 },
  { kind: 'ocean', water: [40, 110, 200], waterDeep: [20, 60, 140], land: [80, 170, 120], landHigh: [130, 200, 150], mountain: [60, 120, 100], ice: [230, 245, 255], veg: [40, 150, 90], atmosphere: [110, 200, 255], night: [10, 20, 50], light: [255, 230, 150], cloud: [255, 255, 255], seaLevel: 0.7, hasIceCaps: true, cloudiness: 0.6 },
  { kind: 'candy', water: [255, 150, 190], waterDeep: [220, 100, 150], land: [255, 230, 160], landHigh: [255, 250, 200], mountain: [230, 170, 120], ice: [255, 255, 255], veg: [130, 220, 170], atmosphere: [255, 200, 230], night: [40, 20, 40], light: [255, 240, 200], cloud: [255, 255, 255], seaLevel: 0.48, hasIceCaps: false, cloudiness: 0.5 },
  { kind: 'rust', water: [60, 90, 110], waterDeep: [40, 60, 80], land: [170, 90, 60], landHigh: [210, 130, 90], mountain: [110, 60, 40], ice: [220, 210, 200], veg: [120, 140, 70], atmosphere: [230, 160, 120], night: [26, 16, 16], light: [255, 190, 120], cloud: [220, 200, 190], seaLevel: 0.3, hasIceCaps: false, cloudiness: 0.25 },
]

export function palettePick(seed: number): PlanetPalette {
  const r = mulberry32(seed ^ 0x2545f491)
  const base = PALETTES[Math.floor(r() * PALETTES.length)]
  // slight per-planet hue jitter so no two worlds are identical
  const jitter = (c: RGB): RGB => {
    const k = 0.9 + r() * 0.2
    return [Math.min(255, c[0] * k), Math.min(255, c[1] * (0.92 + r() * 0.16)), Math.min(255, c[2] * k)]
  }
  return {
    ...base,
    water: jitter(base.water),
    land: jitter(base.land),
    veg: jitter(base.veg),
    seaLevel: base.seaLevel + (r() - 0.5) * 0.14,
    cloudiness: base.cloudiness + (r() - 0.5) * 0.2,
  }
}

export const rgb = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k]
