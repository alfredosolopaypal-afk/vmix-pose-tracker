import type { Landmark, Pose } from '../src/core/types';

/** Pose sintética de 33 puntos centrada en (cx, cy) con altura `h` (normalizada). */
export function makePose(cx: number, cy: number, h = 0.5, opts: { rightHandUp?: boolean } = {}): Pose {
  const pts: Landmark[] = [];
  for (let i = 0; i < 33; i++) {
    // Reparto simple de puntos de arriba (cabeza) a abajo (pies)
    const t = i / 32;
    pts.push({ x: cx + ((i % 2) - 0.5) * h * 0.2, y: cy - h / 2 + t * h, z: 0, v: 0.99 });
  }
  // hombros y muñecas coherentes (índices BlazePose)
  pts[11] = { x: cx - 0.05, y: cy - h * 0.25, z: 0, v: 0.99 };
  pts[12] = { x: cx + 0.05, y: cy - h * 0.25, z: 0, v: 0.99 };
  pts[15] = { x: cx - 0.08, y: cy + h * 0.05, z: 0, v: 0.99 };
  pts[16] = { x: cx + 0.08, y: opts.rightHandUp ? cy - h * 0.45 : cy + h * 0.05, z: 0, v: 0.99 };
  return pts;
}
