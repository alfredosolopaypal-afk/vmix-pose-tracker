import { describe, expect, it } from 'vitest';
import { bboxCenter, computeBBox, directionArrow, handsRaised, iou, speedAndDirection } from '../src/core/metrics';
import { makePose } from './helpers';

describe('metrics', () => {
  it('computeBBox envuelve los puntos visibles y respeta [0,1]', () => {
    const b = computeBBox(makePose(0.5, 0.5, 0.6));
    expect(b.y).toBeCloseTo(0.2, 1);
    expect(b.h).toBeCloseTo(0.6, 1);
    const c = bboxCenter(b);
    expect(c.x).toBeCloseTo(0.5, 1);
    const off = computeBBox(makePose(0.98, 0.98, 1.4));
    expect(off.x + off.w).toBeLessThanOrEqual(1);
    expect(off.y + off.h).toBeLessThanOrEqual(1);
  });

  it('iou: idénticas = 1, disjuntas = 0', () => {
    const a = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    expect(iou(a, a)).toBeCloseTo(1);
    expect(iou(a, { x: 0.6, y: 0.6, w: 0.2, h: 0.2 })).toBe(0);
  });

  it('handsRaised detecta la mano derecha levantada', () => {
    expect(handsRaised(makePose(0.5, 0.5, 0.6, { rightHandUp: true }))).toEqual({ left: false, right: true });
    expect(handsRaised(makePose(0.5, 0.5, 0.6))).toEqual({ left: false, right: false });
  });

  it('speedAndDirection: derecha, arriba y reposo', () => {
    const right = speedAndDirection(0.1, 0, 1);
    expect(right.speed).toBeCloseTo(10);
    expect(right.direction).toBeCloseTo(0);
    const up = speedAndDirection(0, -0.1, 1); // y negativo = hacia arriba en pantalla
    expect(up.direction).toBeCloseTo(90);
    expect(speedAndDirection(0, 0, 1.78)).toEqual({ speed: 0, direction: 0 });
  });

  it('aspect convierte el desplazamiento horizontal a unidades de alto', () => {
    expect(speedAndDirection(0.1, 0, 2).speed).toBeCloseTo(20);
  });

  it('directionArrow mapea a 8 direcciones', () => {
    expect(directionArrow(0)).toBe('→');
    expect(directionArrow(90)).toBe('↑');
    expect(directionArrow(180)).toBe('←');
    expect(directionArrow(270)).toBe('↓');
    expect(directionArrow(359)).toBe('→');
  });
});
