import type { BBox, Landmark, Point } from './types';

/** Índices BlazePose (33 puntos) usados por las métricas. */
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Caja que envuelve los puntos visibles (o todos, si ninguno supera `minVis`). */
export function computeBBox(landmarks: readonly Landmark[], minVis = 0.3): BBox {
  let pts = landmarks.filter((p) => p.v >= minVis);
  if (pts.length < 3) pts = [...landmarks];
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX = clamp01(minX);
  minY = clamp01(minY);
  maxX = clamp01(maxX);
  maxY = clamp01(maxY);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function bboxCenter(b: BBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Intersección sobre unión de dos cajas (0..1). */
export function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Una mano está levantada si la muñeca queda claramente por encima del hombro (y crece hacia abajo). */
export function handsRaised(
  landmarks: readonly Landmark[],
  margin = 0.04,
  minVis = 0.5,
): { left: boolean; right: boolean } {
  const check = (wristIdx: number, shoulderIdx: number): boolean => {
    const w = landmarks[wristIdx];
    const s = landmarks[shoulderIdx];
    if (!w || !s || w.v < minVis || s.v < minVis) return false;
    return w.y < s.y - margin;
  };
  return {
    left: check(LM.L_WRIST, LM.L_SHOULDER),
    right: check(LM.R_WRIST, LM.R_SHOULDER),
  };
}

/**
 * Velocidad y dirección a partir de un vector de desplazamiento por segundo en coordenadas
 * normalizadas. `aspect` = ancho/alto del frame, para medir en unidades isótropas (alto de imagen).
 */
export function speedAndDirection(
  vx: number,
  vy: number,
  aspect: number,
): { speed: number; direction: number } {
  const dx = vx * aspect;
  const dy = vy;
  const speed = Math.hypot(dx, dy) * 100;
  if (speed < 1e-6) return { speed: 0, direction: 0 };
  let direction = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (direction < 0) direction += 360;
  return { speed, direction };
}

const ARROWS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'] as const;

/** Flecha de 8 direcciones para mostrar en pantalla. */
export function directionArrow(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return ARROWS[idx] ?? '→';
}
