/**
 * Filtro One Euro (Casiez et al., 2012): suaviza el jitter cuando la persona está quieta
 * y casi no añade retardo cuando se mueve rápido. Ideal para landmarks de pose.
 */
class LowPass {
  private y: number | null = null;

  get last(): number | null {
    return this.y;
  }

  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

export class OneEuroFilter {
  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  private lastT: number | null = null;

  /**
   * @param minCutoff  Frecuencia de corte mínima (Hz). Menor = más suave en reposo.
   * @param beta       Cuánto sube el corte con la velocidad. Mayor = menos retardo al moverse.
   * @param dCutoff    Corte para la derivada (Hz).
   */
  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.05,
    private readonly dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param tSec Tiempo en segundos (monótono creciente). */
  filter(value: number, tSec: number): number {
    if (this.lastT === null) {
      this.lastT = tSec;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = Math.max(tSec - this.lastT, 1e-3);
    this.lastT = tSec;
    const prev = this.x.last ?? value;
    const edx = this.dx.filter((value - prev) / dt, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt));
  }
}
