import type { Delegate, Pose } from '../core/types';

export interface InitMessage {
  type: 'init';
  wasmDir: string;
  modelUrl: string;
  numPoses: number;
  /** Preferencia; el worker cae a CPU si la GPU no está disponible. */
  delegate: Delegate;
}

export interface FrameMessage {
  type: 'frame';
  id: number;
  /** Marca de tiempo monótona en ms (performance.now() del hilo principal). */
  ts: number;
  bitmap: ImageBitmap;
}

export interface ConfigMessage {
  type: 'config';
  numPoses: number;
}

export type ToWorker = InitMessage | FrameMessage | ConfigMessage;

export interface ReadyMessage {
  type: 'ready';
  delegate: Delegate;
}

export interface ResultMessage {
  type: 'result';
  id: number;
  ts: number;
  poses: Pose[];
  /** Duración de la inferencia dentro del worker (ms). */
  inferMs: number;
}

export interface ErrorMessage {
  type: 'error';
  /** Si se conoce, id del frame que falló (para liberar el control de flujo). */
  id?: number;
  message: string;
  fatal: boolean;
}

export type FromWorker = ReadyMessage | ResultMessage | ErrorMessage;
