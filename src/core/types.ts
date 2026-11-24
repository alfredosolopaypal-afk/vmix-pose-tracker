/** Punto de pose normalizado (0..1 respecto al frame). `v` = visibilidad 0..1. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  v: number;
}

export type Pose = Landmark[];

export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Una persona rastreada, con ID estable entre frames y métricas básicas. */
export interface Track {
  id: number;
  landmarks: Landmark[];
  bbox: BBox;
  center: Point;
  /** Velocidad del centro, en % de alto de imagen por segundo. */
  speed: number;
  /** Dirección en grados: 0 = derecha, 90 = arriba, 180 = izquierda, 270 = abajo. */
  direction: number;
  /** Tiempo en pantalla desde que se confirmó el track. */
  ageMs: number;
  /** Manos por encima de los hombros (izquierda/derecha de la persona). */
  handsRaised: { left: boolean; right: boolean };
}

export type Delegate = 'GPU' | 'CPU';

export interface EngineStats {
  /** Resultados de inferencia por segundo. */
  fps: number;
  /** Tiempo de inferencia dentro del worker (ms). */
  inferMs: number;
  /** Tiempo total captura -> resultado (ms). */
  roundtripMs: number;
  /** Lado largo de la imagen enviada al modelo (px). */
  inferSize: number;
  delegate: Delegate;
  trackCount: number;
}

export type Fit = 'contain' | 'cover' | 'stretch';

/** Rectángulo (en px del canvas) donde se dibuja el contenido normalizado 0..1. */
export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}
