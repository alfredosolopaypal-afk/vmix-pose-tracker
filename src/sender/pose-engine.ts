import { AdaptiveQuality } from '../core/adaptive';
import { MODEL_URL, WASM_DIR } from '../config';
import { PoseTracker } from '../core/tracker';
import type { Delegate, EngineStats, Pose, Track } from '../core/types';
import type { FromWorker, ToWorker } from '../workers/messages';
import PoseWorker from '../workers/pose.worker?worker';

export interface EngineOptions {
  targetFps: number;
  maxPoses: number;
  onTracks: (tracks: Track[], stats: EngineStats) => void;
  onError: (message: string, fatal: boolean) => void;
}

/**
 * Orquesta la inferencia: captura frames del <video>, los reduce a la resolución adaptable,
 * los envía al worker (máx. 1 en vuelo) y convierte los resultados en tracks con ID.
 */
export class PoseEngine {
  private worker: Worker | null = null;
  private ready = false;
  private inFlight = false;
  private frameId = 0;
  private lastSubmit = 0;
  private lastResultAt = 0;
  private stuckTimer: number | null = null;

  private readonly tracker = new PoseTracker();
  private readonly quality: AdaptiveQuality;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx2d: CanvasRenderingContext2D;

  private targetFps: number;
  private maxPoses: number;
  private delegate: Delegate = 'GPU';
  private fpsEma = 0;
  private inferEma = 0;
  private roundtripEma = 0;
  private sentAt = new Map<number, number>();

  constructor(private readonly opts: EngineOptions) {
    this.targetFps = opts.targetFps;
    this.maxPoses = opts.maxPoses;
    this.quality = new AdaptiveQuality({ targetFps: opts.targetFps, startIndex: 3 });
    const c = this.canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!c) throw new Error('Canvas 2D no disponible');
    this.ctx2d = c;
  }

  /** Carga el modelo en el worker. Resuelve cuando está listo. */
  start(): Promise<Delegate> {
    return new Promise<Delegate>((resolve, reject) => {
      // `?worker`: Vite lo sirve como módulo en desarrollo y lo compila a worker clásico (IIFE) en producción.
      const worker = new PoseWorker({ name: 'pose-worker' });
      this.worker = worker;

      worker.onmessage = (ev: MessageEvent<FromWorker>) => {
        const msg = ev.data;
        if (msg.type === 'ready') {
          this.ready = true;
          this.delegate = msg.delegate;
          resolve(msg.delegate);
        } else if (msg.type === 'result') {
          this.handleResult(msg.id, msg.ts, msg.poses, msg.inferMs);
        } else {
          if (msg.id !== undefined) this.inFlight = false;
          if (msg.fatal && !this.ready) reject(new Error(msg.message));
          this.opts.onError(msg.message, msg.fatal);
        }
      };
      worker.onerror = (e) => {
        const message = e.message || 'Error en el worker de inferencia';
        if (!this.ready) reject(new Error(message));
        this.opts.onError(message, true);
      };

      this.post({
        type: 'init',
        wasmDir: WASM_DIR(),
        modelUrl: MODEL_URL(),
        numPoses: this.maxPoses,
        delegate: 'GPU',
      });

      // Vigilante: si un frame no vuelve en 4 s, libera el control de flujo.
      this.stuckTimer = window.setInterval(() => {
        if (this.inFlight && performance.now() - this.lastSubmit > 4000) this.inFlight = false;
      }, 1000);
    });
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
    this.quality.setTargetFps(fps);
  }

  setMaxPoses(n: number): void {
    this.maxPoses = n;
    this.post({ type: 'config', numPoses: n });
  }

  /** Olvida IDs (al cambiar de cámara o reiniciar). */
  resetTracking(): void {
    this.tracker.reset();
  }

  /**
   * Llamar en cada frame de vídeo. Aplica el límite de FPS y la contrapresión;
   * si procede, captura y envía el frame al worker.
   */
  submit(video: HTMLVideoElement, now: number): void {
    if (!this.ready || this.inFlight) return;
    if (now - this.lastSubmit < 1000 / this.targetFps - 2) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0 || video.readyState < 2) return;

    this.tracker.setAspect(vw / vh);

    // Reduce el frame a la resolución de inferencia actual.
    const scale = Math.min(1, this.quality.size / Math.max(vw, vh));
    const w = Math.max(2, Math.round(vw * scale));
    const h = Math.max(2, Math.round(vh * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx2d.drawImage(video, 0, 0, w, h);

    this.inFlight = true;
    this.lastSubmit = now;
    const id = ++this.frameId;
    this.sentAt.set(id, now);

    createImageBitmap(this.canvas)
      .then((bitmap) => {
        this.post({ type: 'frame', id, ts: now, bitmap }, [bitmap]);
      })
      .catch(() => {
        this.inFlight = false;
        this.sentAt.delete(id);
      });
  }

  dispose(): void {
    if (this.stuckTimer !== null) window.clearInterval(this.stuckTimer);
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  private handleResult(id: number, ts: number, poses: Pose[], inferMs: number): void {
    this.inFlight = false;
    const sent = this.sentAt.get(id);
    this.sentAt.delete(id);
    const roundtrip = sent !== undefined ? performance.now() - sent : inferMs;
    // Descarta entradas antiguas por si algún id no volvió.
    if (this.sentAt.size > 8) this.sentAt.clear();

    const now = performance.now();
    if (this.lastResultAt > 0) {
      const inst = 1000 / Math.max(now - this.lastResultAt, 1);
      this.fpsEma = this.fpsEma === 0 ? inst : this.fpsEma * 0.85 + inst * 0.15;
    }
    this.lastResultAt = now;
    this.inferEma = this.inferEma === 0 ? inferMs : this.inferEma * 0.8 + inferMs * 0.2;
    this.roundtripEma = this.roundtripEma === 0 ? roundtrip : this.roundtripEma * 0.8 + roundtrip * 0.2;

    this.quality.report(roundtrip);
    const tracks = this.tracker.update(poses, ts);

    this.opts.onTracks(tracks, {
      fps: this.fpsEma,
      inferMs: this.inferEma,
      roundtripMs: this.roundtripEma,
      inferSize: this.quality.size,
      delegate: this.delegate,
      trackCount: tracks.length,
    });
  }

  private post(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }
}
