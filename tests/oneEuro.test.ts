import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from '../src/core/oneEuro';

describe('OneEuroFilter', () => {
  it('devuelve el primer valor tal cual', () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.5, 0)).toBe(0.5);
  });

  it('reduce el ruido cuando la señal está quieta', () => {
    const f = new OneEuroFilter(1.0, 0.0);
    let t = 0;
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 120; i++) {
      t += 1 / 30;
      const noisy = 0.5 + (i % 2 === 0 ? 0.01 : -0.01);
      raw.push(noisy);
      out.push(f.filter(noisy, t));
    }
    const spread = (a: number[]) => Math.max(...a.slice(60)) - Math.min(...a.slice(60));
    expect(spread(out)).toBeLessThan(spread(raw) * 0.5);
  });

  it('sigue un movimiento rápido con poco retardo cuando beta es alto', () => {
    const slow = new OneEuroFilter(1.0, 0.0);
    const fast = new OneEuroFilter(1.0, 5.0);
    let t = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < 30; i++) {
      t += 1 / 30;
      const v = i / 30; // rampa
      a = slow.filter(v, t);
      b = fast.filter(v, t);
    }
    const target = 29 / 30;
    expect(Math.abs(target - b)).toBeLessThan(Math.abs(target - a));
  });
});
