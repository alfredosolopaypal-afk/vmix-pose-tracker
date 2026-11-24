import { bboxCenter, computeBBox, handsRaised, iou, speedAndDirection } from './metrics';
import { OneEuroFilter } from './oneEuro';
import type { BBox, Landmark, Point, Pose, Track } from './types';

export interface TrackerOptions {
  /** Frames consecutivos necesarios para confirmar un track y asignarle ID. */
  minHits: number;
  /** Tiempo máximo que un track puede estar perdido antes de descartarse. */
  maxLostMs: number;
  /** Parámetros del filtro One Euro aplicado a cada landmark. */
  smoothing: { minCutoff: number; beta: number };
  /** Ancho/alto del frame, para medir velocidades en unidades isótropas. */
  aspect: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  minHits: 2,
  maxLostMs: 700,
  smoothing: { minCutoff: 1.2, beta: 0.05 },
  aspect: 16 / 9,
};

interface Internal {
  id: number | null;
  landmarks: Landmark[];
  filters: OneEuroFilter[];
  bbox: BBox;
  center: Point;
  /** Velocidad suavizada (unidades normalizadas / s). */
  vx: number;
  vy: number;
  hits: number;
  firstSeenMs: number;
  lastSeenMs: number;
  matchedThisFrame: boolean;
}

interface Candidate {
  cost: number;
  ti: number;
  di: number;
}

const VEL_EMA = 0.5;
const MAX_PREDICT_S = 0.7;

/**
 * Seguimiento multi-persona con IDs estables.
 * Asociación voraz por coste (IoU + distancia al centro predicho), con confirmación de tracks nuevos
 * para evitar IDs "fantasma", y suavizado One Euro de los landmarks.
 */
export class PoseTracker {
  private readonly opts: TrackerOptions;
  private tracks: Internal[] = [];
  private nextId = 1;

  constructor(options: Partial<TrackerOptions> = {}) {
    this.opts = {
      ...DEFAULT_TRACKER_OPTIONS,
      ...options,
      smoothing: { ...DEFAULT_TRACKER_OPTIONS.smoothing, ...options.smoothing },
    };
  }

  setAspect(aspect: number): void {
    if (Number.isFinite(aspect) && aspect > 0) this.opts.aspect = aspect;
  }

  /** Olvida todos los tracks (p. ej. al cambiar de cámara). Los IDs vuelven a empezar en 1. */
  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }

  /**
   * @param detections Poses detectadas en este frame (landmarks normalizados).
   * @param tMs        Marca de tiempo del frame (ms, monótona).
   * @returns Tracks confirmados y vistos en este frame.
   */
  update(detections: readonly Pose[], tMs: number): Track[] {
    const { aspect, minHits, maxLostMs } = this.opts;
    const tSec = tMs / 1000;

    const dets = detections.map((landmarks) => {
      const bbox = computeBBox(landmarks);
      return { landmarks, bbox, center: bboxCenter(bbox) };
    });

    // 1) Costes de asociación track <-> detección
    const candidates: Candidate[] = [];
    this.tracks.forEach((tr, ti) => {
      tr.matchedThisFrame = false;
      const dtTrack = Math.min(Math.max((tMs - tr.lastSeenMs) / 1000, 0), MAX_PREDICT_S);
      const pred: Point = { x: tr.center.x + tr.vx * dtTrack, y: tr.center.y + tr.vy * dtTrack };
      const predBox: BBox = {
        x: tr.bbox.x + (pred.x - tr.center.x),
        y: tr.bbox.y + (pred.y - tr.center.y),
        w: tr.bbox.w,
        h: tr.bbox.h,
      };
      dets.forEach((d, di) => {
        const overlap = iou(predBox, d.bbox);
        const dist = Math.hypot((pred.x - d.center.x) * aspect, pred.y - d.center.y);
        if (overlap <= 0.05 && dist >= 0.18) return; // fuera de rango
        const cost = 0.7 * (1 - overlap) + 0.3 * Math.min(dist / 0.4, 1);
        candidates.push({ cost, ti, di });
      });
    });
    candidates.sort((a, b) => a.cost - b.cost);

    const usedTracks = new Set<number>();
    const usedDets = new Set<number>();

    // 2) Asignación voraz
    for (const c of candidates) {
      if (usedTracks.has(c.ti) || usedDets.has(c.di)) continue;
      usedTracks.add(c.ti);
      usedDets.add(c.di);
      const tr = this.tracks[c.ti];
      const det = dets[c.di];
      if (tr && det) this.applyMatch(tr, det.landmarks, tMs, tSec);
    }

    // 3) Detecciones sin track -> tracks nuevos (provisionales)
    dets.forEach((d, di) => {
      if (usedDets.has(di)) return;
      this.tracks.push(this.createTrack(d.landmarks, tMs, tSec));
    });

    // 4) Limpieza de tracks perdidos
    this.tracks = this.tracks.filter((tr) => {
      if (tr.matchedThisFrame) return true;
      if (tr.id === null) return false; // un provisional que falla un frame se descarta
      return tMs - tr.lastSeenMs <= maxLostMs;
    });

    // 5) Confirmación de IDs y salida
    const out: Track[] = [];
    for (const tr of this.tracks) {
      if (!tr.matchedThisFrame) continue;
      if (tr.id === null && tr.hits >= minHits) tr.id = this.nextId++;
      if (tr.id === null) continue;
      const { speed, direction } = speedAndDirection(tr.vx, tr.vy, aspect);
      out.push({
        id: tr.id,
        landmarks: tr.landmarks,
        bbox: tr.bbox,
        center: tr.center,
        speed,
        direction,
        ageMs: tMs - tr.firstSeenMs,
        handsRaised: handsRaised(tr.landmarks),
      });
    }
    return out.sort((a, b) => a.id - b.id);
  }

  private createTrack(raw: Pose, tMs: number, tSec: number): Internal {
    const { minCutoff, beta } = this.opts.smoothing;
    const filters = Array.from({ length: raw.length * 2 }, () => new OneEuroFilter(minCutoff, beta));
    const landmarks = this.smooth(filters, raw, tSec);
    const bbox = computeBBox(landmarks);
    return {
      id: null,
      landmarks,
      filters,
      bbox,
      center: bboxCenter(bbox),
      vx: 0,
      vy: 0,
      hits: 1,
      firstSeenMs: tMs,
      lastSeenMs: tMs,
      matchedThisFrame: true,
    };
  }

  private applyMatch(tr: Internal, raw: Pose, tMs: number, tSec: number): void {
    const dt = Math.min(Math.max((tMs - tr.lastSeenMs) / 1000, 0.001), 0.5);
    const landmarks = this.smooth(tr.filters, raw, tSec);
    const bbox = computeBBox(landmarks);
    const center = bboxCenter(bbox);

    const rvx = (center.x - tr.center.x) / dt;
    const rvy = (center.y - tr.center.y) / dt;
    tr.vx = tr.vx * (1 - VEL_EMA) + rvx * VEL_EMA;
    tr.vy = tr.vy * (1 - VEL_EMA) + rvy * VEL_EMA;

    tr.landmarks = landmarks;
    tr.bbox = bbox;
    tr.center = center;
    tr.hits += 1;
    tr.lastSeenMs = tMs;
    tr.matchedThisFrame = true;
  }

  private smooth(filters: OneEuroFilter[], raw: Pose, tSec: number): Landmark[] {
    return raw.map((p, i) => {
      const fx = filters[i * 2];
      const fy = filters[i * 2 + 1];
      return {
        x: fx ? fx.filter(p.x, tSec) : p.x,
        y: fy ? fy.filter(p.y, tSec) : p.y,
        z: p.z,
        v: p.v,
      };
    });
  }
}
