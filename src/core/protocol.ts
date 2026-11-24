import type { Crop } from './autoframe';
import type { Landmark, Track } from './types';

/**
 * Modos de salida que puede pedir una página receptora (vMix):
 *  - video:   cámara + overlay ya dibujado (un solo vídeo, listo para usar)
 *  - overlay: solo overlay con fondo transparente, dibujado en el receptor (se superpone a otra fuente)
 *  - raw:     cámara limpia, sin overlay
 */
export type Mode = 'video' | 'overlay' | 'raw';

export const MODES: readonly Mode[] = ['video', 'overlay', 'raw'];

export function parseMode(value: unknown): Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value) ? (value as Mode) : 'video';
}

export const MODE_LABELS: Record<Mode, string> = {
  video: 'Video con overlay',
  overlay: 'Solo overlay (transparente)',
  raw: 'Video limpio (sin overlay)',
};

// --- Mensajes por DataChannel ------------------------------------------------

export interface WireTrack {
  id: number;
  /** [x, y, v, x, y, v, ...] con x,y a 4 decimales y v en 0..100. */
  lm: number[];
  /** bbox [x, y, w, h] */
  bb: [number, number, number, number];
  /** velocidad (% alto/s) */
  sp: number;
  /** dirección (grados) */
  dir: number;
  /** edad (ms) */
  age: number;
  /** manos levantadas [izq, der] */
  hr: [0 | 1, 0 | 1];
}

export interface TracksMessage {
  t: 'tracks';
  /** Marca de tiempo del emisor (ms). */
  ts: number;
  /** Tamaño del frame de origen: sirve para conservar la relación de aspecto. */
  w: number;
  h: number;
  /** Si las coordenadas deben espejarse al dibujar. */
  mirror: boolean;
  /** Recorte del encuadre automático [x, y, lado]. Ausente = imagen completa. */
  cr?: [number, number, number];
  tracks: WireTrack[];
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function encodeTracks(
  tracks: readonly Track[],
  meta: { ts: number; w: number; h: number; mirror: boolean; crop?: Crop | null },
): TracksMessage {
  const c = meta.crop;
  return {
    t: 'tracks',
    ts: Math.round(meta.ts),
    w: meta.w,
    h: meta.h,
    mirror: meta.mirror,
    ...(c && c.s < 0.995 ? { cr: [r4(c.x), r4(c.y), r4(c.s)] as [number, number, number] } : {}),
    tracks: tracks.map((tr) => {
      const lm: number[] = [];
      for (const p of tr.landmarks) lm.push(r4(p.x), r4(p.y), Math.round(p.v * 100));
      return {
        id: tr.id,
        lm,
        bb: [r4(tr.bbox.x), r4(tr.bbox.y), r4(tr.bbox.w), r4(tr.bbox.h)],
        sp: r1(tr.speed),
        dir: Math.round(tr.direction),
        age: Math.round(tr.ageMs),
        hr: [tr.handsRaised.left ? 1 : 0, tr.handsRaised.right ? 1 : 0],
      };
    }),
  };
}

export function isTracksMessage(msg: unknown): msg is TracksMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Partial<TracksMessage>;
  return m.t === 'tracks' && Array.isArray(m.tracks) && typeof m.w === 'number' && typeof m.h === 'number';
}

export function decodeTracks(msg: TracksMessage): {
  tracks: Track[];
  w: number;
  h: number;
  mirror: boolean;
  crop: Crop | null;
} {
  const tracks: Track[] = msg.tracks.map((wt) => {
    const landmarks: Landmark[] = [];
    for (let i = 0; i + 2 < wt.lm.length; i += 3) {
      landmarks.push({ x: wt.lm[i] ?? 0, y: wt.lm[i + 1] ?? 0, z: 0, v: (wt.lm[i + 2] ?? 0) / 100 });
    }
    const [bx, by, bw, bh] = wt.bb;
    return {
      id: wt.id,
      landmarks,
      bbox: { x: bx, y: by, w: bw, h: bh },
      center: { x: bx + bw / 2, y: by + bh / 2 },
      speed: wt.sp,
      direction: wt.dir,
      ageMs: wt.age,
      handsRaised: { left: wt.hr[0] === 1, right: wt.hr[1] === 1 },
    };
  });
  const cr = msg.cr;
  const crop: Crop | null =
    Array.isArray(cr) && cr.length === 3 && cr.every((n) => Number.isFinite(n)) && (cr[2] as number) > 0.04
      ? { x: cr[0] as number, y: cr[1] as number, s: Math.min(1, cr[2] as number) }
      : null;
  return { tracks, w: msg.w, h: msg.h, mirror: msg.mirror, crop };
}

// --- Identificador del enlace ------------------------------------------------

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // sin caracteres ambiguos
export const ID_PREFIX = 'vpt-';

/** ID aleatorio y difícil de adivinar (~59 bits): quien tenga el enlace puede conectarse. */
export function generateStreamId(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(12);
  let token = '';
  for (const b of bytes) token += ID_ALPHABET[b % ID_ALPHABET.length];
  return ID_PREFIX + token;
}

function defaultRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function isValidStreamId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(id);
}

// --- Enlaces -----------------------------------------------------------------

export interface SignalingParams {
  peerHost?: string;
  peerPort?: string;
  peerPath?: string;
  peerSecure?: string;
  stun?: boolean;
}

/** Construye la URL de la página receptora que se pega en vMix. */
export function buildReceiverUrl(
  baseHref: string,
  id: string,
  mode: Mode,
  signaling: SignalingParams = {},
): string {
  const url = new URL('receiver.html', baseHref);
  url.search = '';
  url.hash = '';
  url.searchParams.set('id', id);
  url.searchParams.set('mode', mode);
  if (signaling.peerHost) url.searchParams.set('peerHost', signaling.peerHost);
  if (signaling.peerPort) url.searchParams.set('peerPort', signaling.peerPort);
  if (signaling.peerPath) url.searchParams.set('peerPath', signaling.peerPath);
  if (signaling.peerSecure) url.searchParams.set('peerSecure', signaling.peerSecure);
  if (signaling.stun) url.searchParams.set('stun', '1');
  return url.toString();
}

export function signalingFromParams(params: URLSearchParams): SignalingParams {
  const out: SignalingParams = {};
  const host = params.get('peerHost');
  if (host) out.peerHost = host;
  const port = params.get('peerPort');
  if (port) out.peerPort = port;
  const path = params.get('peerPath');
  if (path) out.peerPath = path;
  const secure = params.get('peerSecure');
  if (secure) out.peerSecure = secure;
  if (params.get('stun') === '1') out.stun = true;
  return out;
}
