/**
 * Web Worker de inferencia: toda la carga de MediaPipe vive aquí para no bloquear la UI.
 * Se compila como worker clásico (IIFE) para que el cargador WASM de MediaPipe pueda usar importScripts.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Delegate, Pose } from '../core/types';
import type { FromWorker, InitMessage, ToWorker } from './messages';

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((ev: MessageEvent<ToWorker>) => void) | null;
}
const ctx = self as unknown as WorkerScope;
const send = (msg: FromWorker): void => ctx.postMessage(msg);

let landmarker: PoseLandmarker | null = null;
let lastTs = 0;
let initMsg: InitMessage | null = null;
let activeDelegate: Delegate = 'GPU';
let consecutiveErrors = 0;
let switching = false;

async function create(
  init: InitMessage,
  delegate: Delegate,
): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(init.wasmDir);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: init.modelUrl, delegate },
    runningMode: 'VIDEO',
    numPoses: init.numPoses,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

async function init(msg: InitMessage): Promise<void> {
  initMsg = msg;
  let used: Delegate = msg.delegate;
  try {
    landmarker = await create(msg, msg.delegate);
  } catch (err) {
    if (msg.delegate === 'GPU') {
      // Safari/iOS y algunos Android no exponen WebGL2 en workers: reintento en CPU.
      used = 'CPU';
      landmarker = await create(msg, 'CPU');
    } else {
      throw err;
    }
  }
  activeDelegate = used;
  send({ type: 'ready', delegate: used });
}

/** Algunos dispositivos crean el modelo en GPU pero fallan al inferir: pasamos a CPU una sola vez. */
async function fallbackToCpu(): Promise<void> {
  if (switching || !initMsg || activeDelegate === 'CPU') return;
  switching = true;
  try {
    landmarker?.close();
    landmarker = null;
    landmarker = await create(initMsg, 'CPU');
    activeDelegate = 'CPU';
    consecutiveErrors = 0;
    send({ type: 'ready', delegate: 'CPU' });
  } catch (err) {
    send({ type: 'error', message: `Falló también el modo CPU: ${String(err)}`, fatal: true });
  } finally {
    switching = false;
  }
}

ctx.onmessage = (ev) => {
  const msg = ev.data;

  if (msg.type === 'init') {
    init(msg).catch((err: unknown) => {
      send({ type: 'error', message: `No se pudo cargar el modelo: ${String(err)}`, fatal: true });
    });
    return;
  }

  if (msg.type === 'config') {
    landmarker?.setOptions({ numPoses: msg.numPoses }).catch(() => undefined);
    return;
  }

  if (msg.type === 'frame') {
    const { bitmap, id } = msg;
    if (!landmarker) {
      bitmap.close();
      send({ type: 'error', id, message: 'Modelo aún no listo', fatal: false });
      return;
    }
    try {
      // MediaPipe exige marcas de tiempo estrictamente crecientes.
      const ts = Math.max(msg.ts, lastTs + 1);
      lastTs = ts;
      const t0 = performance.now();
      const result = landmarker.detectForVideo(bitmap, ts);
      const inferMs = performance.now() - t0;

      const poses: Pose[] = result.landmarks.map((pose) =>
        pose.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 1 })),
      );
      consecutiveErrors = 0;
      send({ type: 'result', id, ts: msg.ts, poses, inferMs });
    } catch (err) {
      send({ type: 'error', id, message: String(err), fatal: false });
      if (++consecutiveErrors >= 3) void fallbackToCpu();
    } finally {
      bitmap.close();
    }
  }
};
