/** Lados largos (px) de la imagen que se envía al modelo, de menor a mayor calidad. */
export const RES_LADDER = [256, 320, 384, 480, 640] as const;

export interface AdaptiveOptions {
  targetFps: number;
  /** Índice inicial en RES_LADDER. */
  startIndex?: number;
  /** Índice máximo permitido. */
  maxIndex?: number;
}

/**
 * Controla la resolución de inferencia para sostener el FPS objetivo (15-30) en móviles.
 * Baja un escalón si el tiempo captura->resultado supera el presupuesto de forma sostenida,
 * y sube uno si hay mucho margen durante bastante tiempo (histéresis para no oscilar).
 */
export class AdaptiveQuality {
  private index: number;
  private maxIndex: number;
  private targetFps: number;
  private ema: number | null = null;
  private over = 0;
  private under = 0;
  private cooldown = 0;

  private static readonly DOWN_AFTER = 8;
  private static readonly UP_AFTER = 60;
  private static readonly COOLDOWN = 20;

  constructor(opts: AdaptiveOptions) {
    this.targetFps = opts.targetFps;
    this.maxIndex = Math.min(opts.maxIndex ?? RES_LADDER.length - 1, RES_LADDER.length - 1);
    this.index = Math.min(opts.startIndex ?? 2, this.maxIndex);
  }

  /** Lado largo actual (px). */
  get size(): number {
    return RES_LADDER[this.index] ?? RES_LADDER[0];
  }

  get level(): number {
    return this.index;
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
    this.over = 0;
    this.under = 0;
  }

  /** Fija un tope de calidad (p. ej. según el dispositivo). */
  setMaxIndex(i: number): void {
    this.maxIndex = Math.max(0, Math.min(i, RES_LADDER.length - 1));
    if (this.index > this.maxIndex) this.index = this.maxIndex;
  }

  /**
   * Informa de un resultado de inferencia.
   * @returns true si cambió la resolución.
   */
  report(roundtripMs: number): boolean {
    this.ema = this.ema === null ? roundtripMs : this.ema * 0.8 + roundtripMs * 0.2;
    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }
    const budget = 1000 / this.targetFps;

    if (this.ema > budget * 0.9) {
      this.over++;
      this.under = 0;
    } else if (this.ema < budget * 0.5) {
      this.under++;
      this.over = 0;
    } else {
      this.over = 0;
      this.under = 0;
    }

    if (this.over >= AdaptiveQuality.DOWN_AFTER && this.index > 0) {
      this.index--;
      return this.afterChange();
    }
    if (this.under >= AdaptiveQuality.UP_AFTER && this.index < this.maxIndex) {
      this.index++;
      return this.afterChange();
    }
    return false;
  }

  private afterChange(): boolean {
    this.over = 0;
    this.under = 0;
    this.ema = null;
    this.cooldown = AdaptiveQuality.COOLDOWN;
    return true;
  }
}
