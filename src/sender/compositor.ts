import { drawOverlay, type OverlayOptions } from '../core/render';
import type { Track } from '../core/types';

/**
 * Compone cámara + overlay en un canvas y lo expone como MediaStream (captureStream).
 * Es lo que recibe vMix en modo "video". Solo se dibuja mientras haya algún receptor conectado.
 */
export class Compositor {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;

  constructor() {
    const c = this.canvas.getContext('2d', { alpha: false });
    if (!c) throw new Error('Canvas 2D no disponible');
    this.ctx = c;
  }

  /** Stream del canvas (se crea la primera vez que se pide). */
  getStream(fps = 30): MediaStream {
    if (!this.stream) this.stream = this.canvas.captureStream(fps);
    return this.stream;
  }

  draw(
    video: HTMLVideoElement,
    tracks: readonly Track[],
    overlay: OverlayOptions,
    outLong: number,
    mirrorOutput: boolean,
  ): void {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return;

    const scale = Math.min(1, outLong / Math.max(vw, vh));
    const w = Math.round(vw * scale) & ~1; // dimensiones pares: mejor para los códecs
    const h = Math.round(vh * scale) & ~1;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const { ctx } = this;
    ctx.save();
    if (mirrorOutput) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    drawOverlay(ctx, { x: 0, y: 0, w, h }, tracks, { ...overlay, mirror: mirrorOutput });
  }

  /** Lado largo actual del canvas, útil para elegir el bitrate. */
  get longSide(): number {
    return Math.max(this.canvas.width, this.canvas.height);
  }
}
