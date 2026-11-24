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

/**
 * Pose con anatomía realista de pie. `topY` = coronilla, `h` = altura total del cuerpo (normalizada).
 * Proporciones: ojos 5 %, nariz 6 %, boca 7.5 %, hombros 20 %, codos 38 %, caderas 52 %, rodillas 74 %, tobillos 95 %.
 */
export function makeStanding(cx: number, topY: number, h: number): Pose {
  const pts: Landmark[] = Array.from({ length: 33 }, () => ({ x: cx, y: topY + h * 0.5, z: 0, v: 0.99 }));
  const set = (i: number, dx: number, f: number) => {
    pts[i] = { x: cx + dx * h, y: topY + f * h, z: 0, v: 0.99 };
  };
  set(0, 0, 0.06);
  set(2, -0.02, 0.05);
  set(5, 0.02, 0.05);
  set(7, -0.04, 0.055);
  set(8, 0.04, 0.055);
  set(9, -0.012, 0.075);
  set(10, 0.012, 0.075);
  set(11, -0.1, 0.2);
  set(12, 0.1, 0.2);
  set(13, -0.12, 0.38);
  set(14, 0.12, 0.38);
  set(15, -0.12, 0.5);
  set(16, 0.12, 0.5);
  set(23, -0.06, 0.52);
  set(24, 0.06, 0.52);
  set(25, -0.06, 0.74);
  set(26, 0.06, 0.74);
  set(27, -0.06, 0.95);
  set(28, 0.06, 0.95);
  set(29, -0.06, 0.96);
  set(30, 0.06, 0.96);
  set(31, -0.07, 0.98);
  set(32, 0.07, 0.98);
  return pts;
}
