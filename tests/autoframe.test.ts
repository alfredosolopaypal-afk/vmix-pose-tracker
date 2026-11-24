import { describe, expect, it } from 'vitest';
import {
  AutoFramer,
  FULL_CROP,
  clampCrop,
  cropViewport,
  regionForPose,
  targetForTracks,
} from '../src/core/autoframe';
import { drawOverlay } from '../src/core/render';
import type { Track } from '../src/core/types';
import { makeStanding } from './helpers';

const track = (landmarks: ReturnType<typeof makeStanding>): Pick<Track, 'landmarks'> => ({ landmarks });

describe('regiones por plano', () => {
  const pose = makeStanding(0.5, 0.1, 0.8); // coronilla 0.1, pies ~0.86

  it('close termina poco debajo de los hombros', () => {
    const r = regionForPose(pose, 'close');
    expect(r).not.toBeNull();
    expect(r?.top).toBeLessThan(0.1 + 0.8 * 0.06); // por encima de la nariz
    expect(r?.top).toBeGreaterThan(0.05);
    const shoulders = 0.1 + 0.8 * 0.2;
    expect(r?.bottom).toBeGreaterThan(shoulders);
    expect(r?.bottom).toBeLessThan(0.1 + 0.8 * 0.45);
  });

  it('medium termina en la cintura (caderas)', () => {
    const r = regionForPose(pose, 'medium');
    expect(r?.bottom).toBeCloseTo(0.1 + 0.8 * 0.52, 2);
  });

  it('full llega a los pies', () => {
    const r = regionForPose(pose, 'full');
    expect(r?.bottom).toBeCloseTo(0.1 + 0.8 * 0.98, 2);
  });

  it('off no produce región', () => {
    expect(regionForPose(pose, 'off')).toBeNull();
  });

  it('medium estima la cintura si las caderas no se ven', () => {
    const p = makeStanding(0.5, 0.1, 0.8).map((pt, i) => (i >= 23 ? { ...pt, v: 0.05 } : pt));
    const r = regionForPose(p, 'medium');
    const real = 0.1 + 0.8 * 0.52;
    expect(Math.abs((r?.bottom ?? 0) - real)).toBeLessThan(0.06);
  });
});

describe('objetivo de encuadre', () => {
  const one = [track(makeStanding(0.5, 0.1, 0.8))];

  it('cuanto más cerrado el plano, mayor el zoom (s menor)', () => {
    const c = targetForTracks(one, 'close');
    const m = targetForTracks(one, 'medium');
    const f = targetForTracks(one, 'full');
    expect(c && m && f).toBeTruthy();
    expect((c?.s ?? 0) < (m?.s ?? 0)).toBe(true);
    expect((m?.s ?? 0) < (f?.s ?? 0)).toBe(true);
  });

  it('el recorte de medio cuerpo contiene cabeza y cintura', () => {
    const t = targetForTracks(one, 'medium');
    const crop = clampCrop(t?.cx ?? 0, t?.cy ?? 0, t?.s ?? 1);
    const headTop = 0.1;
    const waist = 0.1 + 0.8 * 0.52;
    expect(crop.y).toBeLessThanOrEqual(headTop);
    expect(crop.y + crop.s).toBeGreaterThanOrEqual(waist);
    expect(crop.s).toBeLessThan(0.7);
  });

  it('con varias personas encuadra a todas', () => {
    const two = [track(makeStanding(0.2, 0.1, 0.7)), track(makeStanding(0.8, 0.15, 0.7))];
    const t = targetForTracks(two, 'medium');
    const alone = targetForTracks([two[0] as Pick<Track, 'landmarks'>], 'medium');
    expect(t?.cx).toBeCloseTo(0.5, 1);
    expect((t?.s ?? 0) > (alone?.s ?? 1)).toBe(true);
  });

  it('respeta el zoom máximo y no sale de [0,1]', () => {
    const tiny = [track(makeStanding(0.5, 0.45, 0.1))];
    const t = targetForTracks(tiny, 'close', 0.25);
    expect(t?.s).toBeGreaterThanOrEqual(0.25);
    const c = clampCrop(0.02, 0.98, 0.3);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y + c.s).toBeLessThanOrEqual(1);
  });

  it('sin tracks no hay objetivo', () => {
    expect(targetForTracks([], 'medium')).toBeNull();
  });
});

describe('AutoFramer', () => {
  const frames = (f: AutoFramer, ms: number, from = 0, tracks: Pick<Track, 'landmarks'>[] = []) => {
    let crop = f.crop;
    for (let t = from; t <= from + ms; t += 33) {
      f.update(tracks, t);
      crop = f.step(t);
    }
    return crop;
  };
  const person = [track(makeStanding(0.5, 0.1, 0.8))];

  it('desactivado devuelve siempre la imagen completa', () => {
    const f = new AutoFramer('off');
    expect(frames(f, 1000, 0, person)).toEqual(FULL_CROP);
  });

  it('hace zoom suave hacia el objetivo, sin saltos', () => {
    const f = new AutoFramer('medium');
    let prev = f.step(0);
    let maxJump = 0;
    for (let t = 33; t <= 4000; t += 33) {
      f.update(person, t);
      const c = f.step(t);
      maxJump = Math.max(maxJump, Math.abs(c.s - prev.s));
      prev = c;
    }
    const target = targetForTracks(person, 'medium');
    expect(Math.abs(prev.s - (target?.s ?? 0))).toBeLessThan(0.02);
    expect(maxJump).toBeLessThan(0.03);
  });

  it('mantiene el encuadre un rato al perder a la persona y luego vuelve a imagen completa', () => {
    const f = new AutoFramer('medium', { holdMs: 1500 });
    const zoomed = frames(f, 4000, 0, person);
    expect(zoomed.s).toBeLessThan(0.7);
    const held = frames(f, 800, 4000, []);
    expect(held.s).toBeLessThan(0.7);
    const back = frames(f, 6000, 4800, []);
    expect(back.s).toBeGreaterThan(0.97);
  });

  it('ignora cambios diminutos del objetivo (zona muerta)', () => {
    const f = new AutoFramer('medium');
    frames(f, 4000, 0, person);
    const a = f.crop;
    const nudged = [track(makeStanding(0.502, 0.101, 0.8))];
    const b = frames(f, 1500, 4000, nudged);
    expect(Math.abs(b.x - a.x)).toBeLessThan(0.002);
    expect(Math.abs(b.s - a.s)).toBeLessThan(0.002);
  });

  it('cambiar de modo reinicia el encuadre', () => {
    const f = new AutoFramer('medium');
    frames(f, 3000, 0, person);
    f.setMode('close');
    expect(f.crop.s).toBe(1);
  });
});

// --- Dibujo con recorte: contexto simulado que registra las llamadas ------------------------
function mockCtx() {
  const moves: Array<[number, number]> = [];
  const arcs: Array<[number, number]> = [];
  const clips: Array<[number, number, number, number]> = [];
  const target: Record<string, unknown> = {
    moveTo: (x: number, y: number) => moves.push([x, y]),
    arc: (x: number, y: number) => arcs.push([x, y]),
    rect: (x: number, y: number, w: number, h: number) => clips.push([x, y, w, h]),
    measureText: () => ({ width: 60 }),
  };
  const ctx = new Proxy(target, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, moves, arcs, clips };
}

describe('dibujo con recorte', () => {
  const lm = makeStanding(0.5, 0.1, 0.8);
  const t: Track = {
    id: 1,
    landmarks: lm,
    bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.8 },
    center: { x: 0.5, y: 0.5 },
    speed: 0,
    direction: 0,
    ageMs: 1000,
    handsRaised: { left: false, right: false },
  };
  const visible = { x: 0, y: 0, w: 1280, h: 720 };
  const opts = { skeleton: true, points: true, bbox: false, ids: false, metrics: false, mirror: false };

  it('sin recorte el viewport es idéntico al área visible', () => {
    expect(cropViewport(FULL_CROP, visible, false)).toEqual(visible);
    expect(cropViewport(FULL_CROP, visible, true)).toEqual(visible);
  });

  it('el centro del recorte cae en el centro de la imagen visible (con y sin espejo)', () => {
    const crop = { x: 0.3, y: 0.1, s: 0.5 };
    const cx = crop.x + crop.s / 2;
    const cy = crop.y + crop.s / 2;
    for (const mirror of [false, true]) {
      const vp = cropViewport(crop, visible, mirror);
      const px = vp.x + (mirror ? 1 - cx : cx) * vp.w;
      const py = vp.y + cy * vp.h;
      expect(px).toBeCloseTo(640, 3);
      expect(py).toBeCloseTo(360, 3);
    }
  });

  it('el borde izquierdo del recorte cae en x=0 (sin espejo) y en x=ancho (con espejo)', () => {
    const crop = { x: 0.3, y: 0.1, s: 0.5 };
    const v0 = cropViewport(crop, visible, false);
    expect(v0.x + crop.x * v0.w).toBeCloseTo(0, 3);
    const v1 = cropViewport(crop, visible, true);
    expect(v1.x + (1 - crop.x) * v1.w).toBeCloseTo(1280, 3);
  });

  it('drawOverlay coloca las articulaciones donde toca y recorta al área visible', () => {
    const crop = { x: 0.3, y: 0.1, s: 0.5 };
    const m = mockCtx();
    drawOverlay(m.ctx, cropViewport(crop, visible, false), [t], opts, visible);
    expect(m.clips[0]).toEqual([0, 0, 1280, 720]);
    // hombro izquierdo (índice 11): x = 0.5 - 0.1*0.8 = 0.42, y = 0.1 + 0.8*0.2 = 0.26
    const expectX = ((0.42 - crop.x) / crop.s) * 1280;
    const expectY = ((0.26 - crop.y) / crop.s) * 720;
    const hit = m.arcs.find(([x, y]) => Math.abs(x - expectX) < 0.01 && Math.abs(y - expectY) < 0.01);
    expect(hit).toBeDefined();
  });

  it('con espejo, el mismo punto aparece reflejado dentro del recorte', () => {
    const crop = { x: 0.3, y: 0.1, s: 0.5 };
    const m = mockCtx();
    drawOverlay(m.ctx, cropViewport(crop, visible, true), [t], { ...opts, mirror: true }, visible);
    const expectX = 1280 - ((0.42 - crop.x) / crop.s) * 1280;
    const expectY = ((0.26 - crop.y) / crop.s) * 720;
    const hit = m.arcs.find(([x, y]) => Math.abs(x - expectX) < 0.01 && Math.abs(y - expectY) < 0.01);
    expect(hit).toBeDefined();
  });
});
