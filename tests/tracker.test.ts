import { describe, expect, it } from 'vitest';
import { PoseTracker } from '../src/core/tracker';
import { makePose } from './helpers';

const DT = 1000 / 30;

describe('PoseTracker', () => {
  it('no asigna ID hasta confirmar el track (minHits)', () => {
    const t = new PoseTracker({ minHits: 2 });
    expect(t.update([makePose(0.5, 0.5)], 0)).toHaveLength(0);
    const out = t.update([makePose(0.5, 0.5)], DT);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(1);
  });

  it('mantiene el ID de una persona que se mueve', () => {
    const t = new PoseTracker();
    let id = -1;
    for (let i = 0; i < 60; i++) {
      const out = t.update([makePose(0.2 + i * 0.008, 0.5)], i * DT);
      if (out[0]) {
        if (id === -1) id = out[0].id;
        expect(out[0].id).toBe(id);
      }
    }
    expect(id).toBe(1);
  });

  it('asigna IDs distintos a dos personas y los conserva', () => {
    const t = new PoseTracker();
    let last: { id: number; x: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const out = t.update([makePose(0.25, 0.5), makePose(0.75, 0.5)], i * DT);
      last = out.map((o) => ({ id: o.id, x: o.center.x }));
    }
    expect(last).toHaveLength(2);
    const left = last.find((o) => o.x < 0.5);
    const right = last.find((o) => o.x > 0.5);
    expect(left?.id).toBe(1);
    expect(right?.id).toBe(2);
  });

  it('recupera el mismo ID tras una pérdida breve', () => {
    const t = new PoseTracker({ maxLostMs: 700 });
    let time = 0;
    let id = -1;
    for (let i = 0; i < 10; i++, time += DT) id = t.update([makePose(0.5, 0.5)], time)[0]?.id ?? id;
    for (let i = 0; i < 5; i++, time += DT) t.update([], time); // 5 frames sin detección (~166 ms)
    const back = t.update([makePose(0.5, 0.5)], time);
    expect(back[0]?.id).toBe(id);
  });

  it('descarta el track tras superar maxLostMs y reutiliza un ID nuevo', () => {
    const t = new PoseTracker({ maxLostMs: 300 });
    let time = 0;
    let first = -1;
    for (let i = 0; i < 6; i++, time += DT) first = t.update([makePose(0.5, 0.5)], time)[0]?.id ?? first;
    for (let i = 0; i < 20; i++, time += DT) t.update([], time); // ~660 ms
    let again = -1;
    for (let i = 0; i < 6; i++, time += DT) again = t.update([makePose(0.5, 0.5)], time)[0]?.id ?? again;
    expect(again).toBeGreaterThan(first);
  });

  it('no confirma una detección que dura un solo frame (sin IDs fantasma)', () => {
    const t = new PoseTracker({ minHits: 2 });
    t.update([makePose(0.5, 0.5)], 0);
    t.update([], DT);
    t.update([makePose(0.9, 0.2)], 2 * DT);
    expect(t.update([], 3 * DT)).toHaveLength(0);
  });

  it('calcula velocidad y dirección hacia la derecha', () => {
    const t = new PoseTracker({ aspect: 1 });
    let out = t.update([], 0);
    for (let i = 0; i < 30; i++) out = t.update([makePose(0.2 + i * 0.01, 0.5)], i * DT);
    const tr = out[0];
    expect(tr).toBeDefined();
    expect(tr?.speed).toBeGreaterThan(15); // 0.01/frame * 30 fps = 30 %/s aprox.
    expect(tr?.speed).toBeLessThan(45);
    const dir = tr?.direction ?? 999;
    expect(Math.min(dir, 360 - dir)).toBeLessThan(10);
  });

  it('reset reinicia los IDs', () => {
    const t = new PoseTracker();
    for (let i = 0; i < 5; i++) t.update([makePose(0.5, 0.5)], i * DT);
    t.reset();
    let id = -1;
    for (let i = 0; i < 5; i++) id = t.update([makePose(0.5, 0.5)], 1000 + i * DT)[0]?.id ?? id;
    expect(id).toBe(1);
  });
});
