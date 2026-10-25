/**
 * 读取 design/observatory.json（Blender 与站点共用的唯一几何定义），换算成 Three.js 坐标。
 * Blender 为 Z 向上；glTF / Three.js 为 Y 向上：(x, y, z)_blender → (x, z, -y)_three。
 */
import raw from '../../../design/observatory.json';

export interface WaveComponent {
  dir: [number, number];
  k: number;
  amp: number;
  speed: number;
  phase: number;
}

export interface CameraPose {
  distance: number;
  elevation: number;
  azimuth: number;
  lens: number;
  target: [number, number, number];
  shiftX?: number;
}

export interface Spec {
  palette: Record<'void' | 'graphite' | 'anodized' | 'steel' | 'bone' | 'amber' | 'teal' | 'copper', string>;
  radius: number;
  seam: number;
  explode: number;
  layers: { id: string; label: string; h: number }[];
  waves: {
    size: number;
    res: number;
    z: number;
    components: WaveComponent[];
    ripple: { amp: number; k: number; speed: number; decay: number };
  };
  camera: Record<'hero' | 'explode', CameraPose>;
}

export const SPEC = raw as unknown as Spec;

/** 组装态下每层底面的高度（Three.js Y）。 */
export function layerBases(): number[] {
  const out: number[] = [];
  let y = 0;
  for (const l of SPEC.layers) {
    out.push(y);
    y += l.h + SPEC.seam;
  }
  return out;
}

/** 爆炸系数 f 下第 i 层（自下而上）的底面高度。 */
export function layerY(i: number, f: number): number {
  return layerBases()[i]! + i * SPEC.explode * f;
}

export function layerCenter(i: number, f: number): number {
  return layerY(i, f) + SPEC.layers[i]!.h / 2;
}

export const STACK_HEIGHT = layerBases().at(-1)! + SPEC.layers.at(-1)!.h;
