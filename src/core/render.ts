import { directionArrow } from './metrics';
import type { Fit, Track, Viewport } from './types';

/** Conexiones del esqueleto BlazePose (33 puntos). */
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // cara
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  // torso y brazos
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  // piernas
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

export interface OverlayOptions {
  skeleton: boolean;
  points: boolean;
  bbox: boolean;
  ids: boolean;
  metrics: boolean;
  /** Espeja el eje X (cámara frontal en modo selfie). */
  mirror: boolean;
}

export const DEFAULT_OVERLAY: OverlayOptions = {
  skeleton: true,
  points: true,
  bbox: false,
  ids: true,
  metrics: true,
  mirror: false,
};

/** Color estable por ID (ángulo áureo -> tonos bien separados). */
export function colorForId(id: number): string {
  return `hsl(${Math.round((id * 137.508) % 360)} 90% 58%)`;
}

/** Calcula dónde cae el frame (w x h) dentro de un canvas (cw x ch). */
export function fitViewport(w: number, h: number, cw: number, ch: number, fit: Fit): Viewport {
  if (fit === 'stretch' || w <= 0 || h <= 0) return { x: 0, y: 0, w: cw, h: ch };
  const scale = fit === 'cover' ? Math.max(cw / w, ch / h) : Math.min(cw / w, ch / h);
  const vw = w * scale;
  const vh = h * scale;
  return { x: (cw - vw) / 2, y: (ch - vh) / 2, w: vw, h: vh };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Dibuja esqueleto, IDs y métricas. No limpia el canvas (quien llama decide).
 * Las dimensiones de línea/tipografía escalan con el alto del viewport, así el resultado
 * se ve igual en la pantalla del móvil, en el vídeo emitido y en la página de vMix.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  tracks: readonly Track[],
  opts: OverlayOptions,
  visible: Viewport = vp,
): void {
  // `vp` es donde caería el frame completo (puede salirse del lienzo si hay zoom);
  // `visible` es el área realmente visible: recorta el dibujo, ancla las etiquetas y fija el grosor.
  const unit = Math.max(visible.h, 240) / 720; // 1.0 a 720p de alto
  const lineW = Math.max(2, 3.5 * unit);
  const dotR = Math.max(2.5, 4 * unit);
  const font = Math.max(12, Math.round(18 * unit));
  const px = (nx: number) => vp.x + (opts.mirror ? 1 - nx : nx) * vp.w;
  const py = (ny: number) => vp.y + ny * vp.h;

  ctx.save();
  ctx.beginPath();
  ctx.rect(visible.x, visible.y, visible.w, visible.h);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.textBaseline = 'middle';

  for (const tr of tracks) {
    const color = colorForId(tr.id);
    const lm = tr.landmarks;

    if (opts.bbox) {
      const x0 = px(opts.mirror ? tr.bbox.x + tr.bbox.w : tr.bbox.x);
      const y0 = py(tr.bbox.y);
      const bw = tr.bbox.w * vp.w;
      const bh = tr.bbox.h * vp.h;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, 2 * unit);
      ctx.setLineDash([8 * unit, 6 * unit]);
      roundRect(ctx, x0, y0, bw, bh, 8 * unit);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (opts.skeleton) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineW;
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 4 * unit;
      ctx.beginPath();
      for (const [a, b] of POSE_CONNECTIONS) {
        const pa = lm[a];
        const pb = lm[b];
        if (!pa || !pb || pa.v < 0.4 || pb.v < 0.4) continue;
        ctx.moveTo(px(pa.x), py(pa.y));
        ctx.lineTo(px(pb.x), py(pb.y));
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (opts.points) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, 2 * unit);
      for (let i = 0; i < lm.length; i++) {
        const p = lm[i];
        if (!p || p.v < 0.4 || i < 11) continue; // la cara se omite: solo cuerpo
        ctx.beginPath();
        ctx.arc(px(p.x), py(p.y), dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if ((opts.ids || opts.metrics) && lm.length > 0) {
      const parts: string[] = [];
      if (opts.ids) parts.push(`ID ${tr.id}`);
      if (opts.metrics) {
        parts.push(`${Math.round(tr.speed)} %/s ${directionArrow(tr.direction)}`);
        if (tr.handsRaised.left || tr.handsRaised.right) parts.push('✋');
      }
      const text = parts.join('  ·  ');
      ctx.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      const padX = font * 0.6;
      const boxH = font * 1.7;
      const boxW = ctx.measureText(text).width + padX * 2;

      const head = lm[0];
      const anchorX = px(head ? head.x : tr.center.x);
      const topY = py(tr.bbox.y);
      let bx = anchorX - boxW / 2;
      let by = topY - boxH - 8 * unit;
      bx = Math.min(Math.max(bx, visible.x + 4), visible.x + visible.w - boxW - 4);
      by = Math.min(Math.max(by, visible.y + 4), visible.y + visible.h - boxH - 4);

      ctx.fillStyle = 'rgba(8,10,14,0.72)';
      roundRect(ctx, bx, by, boxW, boxH, boxH / 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bx + padX * 0.55, by + boxH / 2, font * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f4f7fb';
      ctx.fillText(text, bx + padX + font * 0.15, by + boxH / 2 + 1);
    }
  }
  ctx.restore();
}
