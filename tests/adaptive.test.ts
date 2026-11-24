import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, RES_LADDER } from '../src/core/adaptive';

describe('AdaptiveQuality', () => {
  it('baja la resolución si el tiempo supera el presupuesto de forma sostenida', () => {
    const q = new AdaptiveQuality({ targetFps: 30, startIndex: 3 });
    const start = q.size;
    let changed = false;
    for (let i = 0; i < 20; i++) changed = q.report(60) || changed; // 60 ms > 33 ms
    expect(changed).toBe(true);
    expect(q.size).toBeLessThan(start);
  });

  it('sube la resolución solo tras mucho margen sostenido', () => {
    const q = new AdaptiveQuality({ targetFps: 30, startIndex: 1 });
    for (let i = 0; i < 30; i++) q.report(5);
    expect(q.level).toBe(1); // todavía no: histéresis
    for (let i = 0; i < 100; i++) q.report(5);
    expect(q.level).toBeGreaterThan(1);
  });

  it('no sale del rango y respeta maxIndex', () => {
    const q = new AdaptiveQuality({ targetFps: 30, startIndex: 0, maxIndex: 2 });
    for (let i = 0; i < 2000; i++) q.report(60);
    expect(q.level).toBe(0);
    const up = new AdaptiveQuality({ targetFps: 15, startIndex: 0, maxIndex: 2 });
    for (let i = 0; i < 2000; i++) up.report(1);
    expect(up.level).toBe(2);
    expect(up.size).toBe(RES_LADDER[2]);
  });

  it('con 15 fps objetivo tolera tiempos que a 30 fps obligarían a bajar', () => {
    const q30 = new AdaptiveQuality({ targetFps: 30, startIndex: 3 });
    const q15 = new AdaptiveQuality({ targetFps: 15, startIndex: 3 });
    for (let i = 0; i < 40; i++) {
      q30.report(45);
      q15.report(45);
    }
    expect(q30.level).toBeLessThan(3);
    expect(q15.level).toBe(3);
  });
});
