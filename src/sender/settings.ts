import { SETTINGS_KEY } from '../config';
import { FRAME_MODES, type FrameMode } from '../core/autoframe';
import type { SignalingParams } from '../core/protocol';

export type Facing = 'user' | 'environment';
export type CamRes = 'auto' | '480' | '720' | '1080';

export interface Settings {
  facing: Facing;
  camRes: CamRes;
  maxPoses: number;
  targetFps: number;
  /** Lado largo (px) del vídeo emitido en modo "video". */
  outLong: number;
  /** Encuadre automático (zoom digital que sigue a la persona). */
  frameMode: FrameMode;
  skeleton: boolean;
  points: boolean;
  bbox: boolean;
  ids: boolean;
  metrics: boolean;
  mirrorOutput: boolean;
  stun: boolean;
  signaling: SignalingParams;
}

export const DEFAULT_SETTINGS: Settings = {
  facing: 'environment',
  camRes: 'auto',
  maxPoses: 2,
  targetFps: 30,
  outLong: 1280,
  frameMode: 'off',
  skeleton: true,
  points: true,
  bbox: false,
  ids: true,
  metrics: true,
  mirrorOutput: false,
  stun: false,
  signaling: {},
};

const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Lee y valida los ajustes guardados; cualquier valor inválido vuelve a su valor por defecto. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const sig = (typeof r.signaling === 'object' && r.signaling !== null ? r.signaling : {}) as Record<string, unknown>;
  const signaling: SignalingParams = {};
  for (const k of ['peerHost', 'peerPort', 'peerPath', 'peerSecure'] as const) {
    const v = sig[k];
    if (typeof v === 'string' && v.length > 0 && v.length < 200) signaling[k] = v;
  }
  return {
    facing: oneOf(r.facing, ['user', 'environment'] as const, d.facing),
    camRes: oneOf(r.camRes, ['auto', '480', '720', '1080'] as const, d.camRes),
    maxPoses: oneOf(r.maxPoses, [1, 2, 3, 4] as const, d.maxPoses as 2),
    targetFps: oneOf(r.targetFps, [15, 24, 30] as const, d.targetFps as 30),
    outLong: oneOf(r.outLong, [960, 1280, 1920] as const, d.outLong as 1280),
    frameMode: oneOf(r.frameMode, FRAME_MODES, d.frameMode),
    skeleton: bool(r.skeleton, d.skeleton),
    points: bool(r.points, d.points),
    bbox: bool(r.bbox, d.bbox),
    ids: bool(r.ids, d.ids),
    metrics: bool(r.metrics, d.metrics),
    mirrorOutput: bool(r.mirrorOutput, d.mirrorOutput),
    stun: bool(r.stun, d.stun),
    signaling,
  };
}

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(SETTINGS_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* almacenamiento no disponible (modo privado): se ignora */
  }
}
