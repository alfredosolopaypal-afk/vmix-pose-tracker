/**
 * Rutas de los recursos que se sirven localmente (nada de CDN en tiempo de ejecución).
 * `document.baseURI` respeta subcarpetas como /mi-repo/ en GitHub Pages.
 */
const base = (rel: string): string => new URL(rel, document.baseURI).href;

export const WASM_DIR = (): string => base('wasm');
export const MODEL_URL = (): string => base('models/pose_landmarker_lite.task');

export const APP_NAME = 'Pose Tracker → vMix';
export const SETTINGS_KEY = 'vpt.settings.v1';
export const STREAM_ID_KEY = 'vpt.streamId.v1';
