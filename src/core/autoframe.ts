import type { Landmark, Track, Viewport } from './types';

/**
 * Encuadre automático (zoom digital que sigue a la persona).
 *  - off:    imagen completa de la cámara
 *  - close:  primer plano, cabeza y hombros
 *  - medium: medio cuerpo, cabeza a cintura
 *  - full:   cuerpo completo
 */
export type FrameMode = 'off' | 'close' | 'medium' | 'full';

export const FRAME_MODES: readonly FrameMode[] = ['off', 'close', 'medium', 'full'];

export const FRAME_LABELS: Record<FrameMode, string> = {
  off: 'Desactivado (imagen completa)',
  close: 'Primer plano (cabeza y hombros)',
  medium: 'Medio cuerpo (cabeza a cintura)',
  full: 'Cuerpo completo',
};

/**
 * Recorte cuadrado en coordenadas normalizadas del frame: esquina (x, y) y lado `s` (0..1).
 * Ancho y alto normalizados son iguales, así que la relación de aspecto de la cámara se conserva
 * y la imagen recortada nunca se deforma.
 */
export interface Crop {
  x: number;
  y: number;
  s: number;
}

export const FULL_CROP: Crop = { x: 0, y: 0, s: 1 };

export function isFullCrop(c: Crop): boolean {
  return c.s >= 0.995;
}

const VIS = 0.35;

/** Índices BlazePose usados. */
const I = {
  NOSE: 0,
  EYES: [2, 5],
  EARS: [7, 8],
  MOUTH: [9, 10],
  SHOULDERS: [11, 12],
  ELBOWS: [13, 14],
  HIPS: [23, 24],
  LOWER: [27, 28, 29, 30, 31, 32],
} as const;

interface Region {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const seen = (lm: readonly Landmark[], i: number): Landmark | null => {
  const p = lm[i];
  return p && p.v >= VIS ? p : null;
};

function avgY(lm: readonly Landmark[], ids: readonly number[]): number | null {
  const ys = ids.map((i) => seen(lm, i)).filter((p): p is Landmark => p !== null).map((p) => p.y);
  return ys.length === 0 ? null : ys.reduce((a, b) => a + b, 0) / ys.length;
}

function xRange(lm: readonly Landmark[], ids: readonly number[]): [number, number] | null {
  const xs = ids.map((i) => seen(lm, i)).filter((p): p is Landmark => p !== null).map((p) => p.x);
  return xs.length === 0 ? null : [Math.min(...xs), Math.max(...xs)];
}

/** Estima la coronilla (BlazePose no la da): usa nariz-hombros y ojos-boca, y toma la más alta. */
function headTop(lm: readonly Landmark[], shoulderY: number | null): number | null {
  const candidates: number[] = [];
  const nose = seen(lm, I.NOSE);
  if (nose && shoulderY !== null && shoulderY > nose.y) candidates.push(nose.y - 0.75 * (shoulderY - nose.y));
  const eyeY = avgY(lm, I.EYES);
  const mouthY = avgY(lm, I.MOUTH);
  if (eyeY !== null && mouthY !== null && mouthY > eyeY) {
    candidates.push(eyeY - 1.9 * Math.max(mouthY - eyeY, 0.01));
  }
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/** Región (cabeza→cintura, etc.) que ocupa una persona para el plano pedido, sin márgenes. */
export function regionForPose(lm: readonly Landmark[], mode: FrameMode): Region | null {
  if (mode === 'off') return null;
  const visible = lm.filter((p) => p.v >= VIS);
  if (visible.length < 4) return null;

  const bboxTop = Math.min(...visible.map((p) => p.y));
  const bboxBottom = Math.max(...visible.map((p) => p.y));
  const bboxLeft = Math.min(...visible.map((p) => p.x));
  const bboxRight = Math.max(...visible.map((p) => p.x));

  const shoulderY = avgY(lm, I.SHOULDERS);
  const top = headTop(lm, shoulderY) ?? bboxTop;

  if (mode === 'full') {
    const feet = avgY(lm, I.LOWER);
    const lower = I.LOWER.map((i) => seen(lm, i)).filter((p): p is Landmark => p !== null);
    const bottom = feet !== null ? Math.max(...lower.map((p) => p.y)) : bboxBottom;
    return { top: Math.min(top, bboxTop), bottom, left: bboxLeft, right: bboxRight };
  }

  // Sin hombros no se puede estimar el torso: se usa la caja de lo visible.
  if (shoulderY === null) return { top: Math.min(top, bboxTop), bottom: bboxBottom, left: bboxLeft, right: bboxRight };

  if (mode === 'close') {
    const bottom = shoulderY + 0.5 * (shoulderY - top);
    const xr = xRange(lm, [I.NOSE, ...I.EARS, ...I.SHOULDERS]) ?? [bboxLeft, bboxRight];
    return { top, bottom, left: xr[0], right: xr[1] };
  }

  // medium: hasta la cintura (caderas); si no se ven, se estima por proporciones.
  const hipY = avgY(lm, I.HIPS);
  const bottom = hipY !== null ? hipY : shoulderY + 1.6 * (shoulderY - top);
  const xr = xRange(lm, [I.NOSE, ...I.SHOULDERS, ...I.ELBOWS, ...I.HIPS]) ?? [bboxLeft, bboxRight];
  return { top, bottom, left: xr[0], right: xr[1] };
}

const PAD: Record<Exclude<FrameMode, 'off'>, { top: number; bottom: number; side: number }> = {
  close: { top: 0.1, bottom: 0.04, side: 1.35 },
  medium: { top: 0.12, bottom: 0.06, side: 1.3 },
  full: { top: 0.06, bottom: 0.06, side: 1.15 },
};

export interface FrameTarget {
  cx: number;
  cy: number;
  s: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Objetivo de encuadre que incluye a todas las personas. `null` si no hay datos útiles. */
export function targetForTracks(
  tracks: readonly Pick<Track, 'landmarks'>[],
  mode: FrameMode,
  minS = 0.25,
): FrameTarget | null {
  if (mode === 'off') return null;
  const regions = tracks.map((t) => regionForPose(t.landmarks, mode)).filter((r): r is Region => r !== null);
  if (regions.length === 0) return null;

  let top = Math.min(...regions.map((r) => r.top));
  let bottom = Math.max(...regions.map((r) => r.bottom));
  const left = Math.min(...regions.map((r) => r.left));
  const right = Math.max(...regions.map((r) => r.right));

  const pad = PAD[mode];
  const h = Math.max(bottom - top, 0.02);
  top -= pad.top * h;
  bottom += pad.bottom * h;

  const need = Math.max(bottom - top, (right - left) * pad.side);
  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    s: clamp(need, minS, 1),
  };
}

export function clampCrop(cx: number, cy: number, s: number): Crop {
  const size = clamp(s, 0.05, 1);
  return { x: clamp(cx - size / 2, 0, 1 - size), y: clamp(cy - size / 2, 0, 1 - size), s: size };
}

export interface AutoFramerOptions {
  /** Zoom máximo permitido (4 = recorte de 1/4 del lado). */
  maxZoom: number;
  /** Tiempo que se mantiene el encuadre sin ver a nadie antes de volver a imagen completa. */
  holdMs: number;
  /** Constante de tiempo del movimiento (s). Mayor = más suave y lento. */
  moveTau: number;
  /** Constante de tiempo del zoom (s). */
  zoomTau: number;
}

export const DEFAULT_FRAMER_OPTIONS: AutoFramerOptions = {
  maxZoom: 4,
  holdMs: 2000,
  moveTau: 0.35,
  zoomTau: 0.6,
};

/**
 * Mantiene el recorte actual y lo mueve con suavidad hacia el objetivo calculado a partir de los tracks.
 * `update` se llama al llegar resultados de IA; `step` en cada frame de video.
 */
export class AutoFramer {
  private readonly opts: AutoFramerOptions;
  private cx = 0.5;
  private cy = 0.5;
  private s = 1;
  private target: FrameTarget = { cx: 0.5, cy: 0.5, s: 1 };
  private hasTarget = false;
  private lastSeen = Number.NEGATIVE_INFINITY;
  private lastStep: number | null = null;

  constructor(
    private mode: FrameMode = 'off',
    options: Partial<AutoFramerOptions> = {},
  ) {
    this.opts = { ...DEFAULT_FRAMER_OPTIONS, ...options };
  }

  get currentMode(): FrameMode {
    return this.mode;
  }

  setMode(mode: FrameMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.reset();
  }

  reset(): void {
    this.cx = 0.5;
    this.cy = 0.5;
    this.s = 1;
    this.target = { cx: 0.5, cy: 0.5, s: 1 };
    this.hasTarget = false;
    this.lastSeen = Number.NEGATIVE_INFINITY;
    this.lastStep = null;
  }

  /** Recalcula el objetivo con los tracks más recientes. */
  update(tracks: readonly Pick<Track, 'landmarks'>[], tMs: number): void {
    if (this.mode === 'off') return;
    const t = targetForTracks(tracks, this.mode, 1 / this.opts.maxZoom);
    if (t) {
      this.lastSeen = tMs;
      // Zona muerta: pequeños cambios del objetivo se ignoran para que el encuadre no "respire".
      const moved =
        Math.abs(t.cx - this.target.cx) > 0.03 * this.target.s ||
        Math.abs(t.cy - this.target.cy) > 0.03 * this.target.s ||
        Math.abs(t.s - this.target.s) > 0.05 * this.target.s;
      if (!this.hasTarget || moved) {
        this.target = t;
        this.hasTarget = true;
      }
    } else if (tMs - this.lastSeen > this.opts.holdMs && this.hasTarget) {
      this.target = { cx: 0.5, cy: 0.5, s: 1 };
      this.hasTarget = false;
    }
  }

  /** Avanza la animación y devuelve el recorte a usar en este frame. */
  step(tMs: number): Crop {
    if (this.mode === 'off') return FULL_CROP;
    const dt = this.lastStep === null ? 0 : clamp((tMs - this.lastStep) / 1000, 0, 0.25);
    this.lastStep = tMs;
    const aMove = 1 - Math.exp(-dt / this.opts.moveTau);
    const aZoom = 1 - Math.exp(-dt / this.opts.zoomTau);
    this.cx += (this.target.cx - this.cx) * aMove;
    this.cy += (this.target.cy - this.cy) * aMove;
    this.s += (this.target.s - this.s) * aZoom;
    return clampCrop(this.cx, this.cy, this.s);
  }

  /** Último recorte calculado (sin avanzar la animación). */
  get crop(): Crop {
    return this.mode === 'off' ? FULL_CROP : clampCrop(this.cx, this.cy, this.s);
  }
}

/**
 * Viewport con el que hay que llamar a `drawOverlay` para que las coordenadas normalizadas
 * del frame completo caigan en su sitio dentro del área visible (`visible`) ya recortada.
 * Con `mirror`, `drawOverlay` refleja respecto al propio viewport, por eso el desplazamiento cambia.
 */
export function cropViewport(crop: Crop, visible: Viewport, mirror: boolean): Viewport {
  const w = visible.w / crop.s;
  const h = visible.h / crop.s;
  const x = mirror ? visible.x + visible.w - (1 - crop.x) * w : visible.x - crop.x * w;
  const y = visible.y - crop.y * h;
  return { x, y, w, h };
}
