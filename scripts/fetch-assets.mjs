// Prepara los recursos que la app sirve de forma local (sin CDN en tiempo de ejecución):
//   1) Copia los binarios WASM de MediaPipe desde node_modules a public/wasm
//   2) Descarga el modelo de pose a public/models (solo si no existe todavía)
//
// Uso:   node scripts/fetch-assets.mjs            -> avisa si falla, no rompe la instalación
//        node scripts/fetch-assets.mjs --strict   -> sale con error si falta algo (build)
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

const MODEL_URL =
  process.env.POSE_MODEL_URL ??
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const MODEL_FILE = join(root, 'public', 'models', 'pose_landmarker_lite.task');
const WASM_SRC = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const WASM_DST = join(root, 'public', 'wasm');
const MIN_MODEL_BYTES = 1_000_000;

let problems = 0;
const warn = (msg) => {
  problems++;
  console.warn(`[assets] ${msg}`);
};

// 1) WASM -------------------------------------------------------------------
if (existsSync(WASM_SRC)) {
  mkdirSync(WASM_DST, { recursive: true });
  cpSync(WASM_SRC, WASM_DST, { recursive: true });
  console.log(`[assets] WASM copiado: ${readdirSync(WASM_DST).length} archivos -> public/wasm`);
} else if (!existsSync(WASM_DST)) {
  warn('No se encontró @mediapipe/tasks-vision en node_modules. Ejecuta "npm install".');
}

// 2) Modelo -----------------------------------------------------------------
const modelOk = () => existsSync(MODEL_FILE) && statSync(MODEL_FILE).size > MIN_MODEL_BYTES;

if (modelOk()) {
  console.log('[assets] Modelo ya presente, se omite la descarga.');
} else {
  mkdirSync(dirname(MODEL_FILE), { recursive: true });
  try {
    console.log('[assets] Descargando modelo de pose (~6 MB)...');
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_MODEL_BYTES) throw new Error(`archivo demasiado pequeño (${buf.length} bytes)`);
    writeFileSync(MODEL_FILE, buf);
    console.log(`[assets] Modelo guardado (${(buf.length / 1e6).toFixed(1)} MB).`);
  } catch (err) {
    warn(
      `No se pudo descargar el modelo (${err.message}).\n` +
        `         Descárgalo manualmente y guárdalo como public/models/pose_landmarker_lite.task:\n` +
        `         ${MODEL_URL}`,
    );
  }
}

if (problems > 0 && strict) {
  console.error('[assets] Faltan recursos; abortando (--strict).');
  process.exit(1);
}
