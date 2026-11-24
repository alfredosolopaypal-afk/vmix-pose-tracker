import '../style.css';
import { STREAM_ID_KEY } from '../config';
import { buildPeerOptions } from '../core/peer-config';
import {
  MODES,
  MODE_LABELS,
  buildReceiverUrl,
  encodeTracks,
  generateStreamId,
  isValidStreamId,
  signalingFromParams,
  type Mode,
  type SignalingParams,
} from '../core/protocol';
import { drawOverlay, fitViewport, type OverlayOptions } from '../core/render';
import type { EngineStats, Track } from '../core/types';
import { CameraError, startCamera, stopStream, type CameraHandle } from './camera';
import { Compositor } from './compositor';
import { PoseEngine } from './pose-engine';
import { loadSettings, saveSettings, type CamRes, type Facing, type Settings } from './settings';
import { StreamHub, type HubStatus } from './stream-hub';

// -----------------------------------------------------------------------------
// Utilidades DOM
// -----------------------------------------------------------------------------
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
}

const video = $<HTMLVideoElement>('video');
const overlay = $<HTMLCanvasElement>('overlay');
const startScreen = $<HTMLElement>('start');
const startMsg = $<HTMLElement>('start-msg');
const btnStart = $<HTMLButtonElement>('btn-start');
const hud = $<HTMLElement>('hud');
const controls = $<HTMLElement>('controls');
const toastEl = $<HTMLElement>('toast');
const chipFps = $<HTMLElement>('chip-fps');
const chipRes = $<HTMLElement>('chip-res');
const chipPpl = $<HTMLElement>('chip-ppl');
const chipLink = $<HTMLElement>('chip-link');
const sheetLink = $<HTMLElement>('sheet-link');
const sheetSettings = $<HTMLElement>('sheet-settings');
const linkList = $<HTMLElement>('link-list');
const linkStatus = $<HTMLElement>('link-status');

const ctx = overlay.getContext('2d');
if (!ctx) throw new Error('Canvas 2D no disponible');

// -----------------------------------------------------------------------------
// Estado
// -----------------------------------------------------------------------------
const settings: Settings = loadSettings();
applyUrlSignaling();

let streamId = loadStreamId();
let camera: CameraHandle | null = null;
let engine: PoseEngine | null = null;
let hub: StreamHub | null = null;
const compositor = new Compositor();

let tracks: Track[] = [];
let stats: EngineStats | null = null;
let hubStatus: HubStatus = { signaling: 'idle', receivers: 0, byMode: { video: 0, overlay: 0, raw: 0 } };
let running = false;
let wakeLock: WakeLockSentinel | null = null;
let toastTimer: number | null = null;
let cameraRestartTimer: number | null = null;
let canvasCssW = 0;
let canvasCssH = 0;

// -----------------------------------------------------------------------------
// Ajustes / identificador
// -----------------------------------------------------------------------------
/** Si la URL trae parámetros de señalización propios (peerHost...), se guardan para reutilizarlos. */
function applyUrlSignaling(): void {
  const fromUrl = signalingFromParams(new URLSearchParams(location.search));
  const { stun, ...custom } = fromUrl;
  let changed = false;
  if (Object.keys(custom).length > 0) {
    settings.signaling = custom;
    changed = true;
  }
  if (stun && !settings.stun) {
    settings.stun = true;
    changed = true;
  }
  if (changed) saveSettings(settings);
}

function loadStreamId(): string {
  try {
    const stored = localStorage.getItem(STREAM_ID_KEY);
    if (isValidStreamId(stored)) return stored;
  } catch {
    /* sin almacenamiento */
  }
  return persistStreamId(generateStreamId());
}

function persistStreamId(id: string): string {
  try {
    localStorage.setItem(STREAM_ID_KEY, id);
  } catch {
    /* sin almacenamiento */
  }
  return id;
}

const signalingForLinks = (): SignalingParams => ({ ...settings.signaling, stun: settings.stun });

const overlayOptions = (mirror: boolean): OverlayOptions => ({
  skeleton: settings.skeleton,
  points: settings.points,
  bbox: settings.bbox,
  ids: settings.ids,
  metrics: settings.metrics,
  mirror,
});

const bitrateFor = (outLong: number): number => (outLong >= 1920 ? 8_000_000 : outLong >= 1280 ? 4_000_000 : 2_500_000);

// -----------------------------------------------------------------------------
// Avisos
// -----------------------------------------------------------------------------
function toast(message: string, ms = 4000): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, ms);
}

// -----------------------------------------------------------------------------
// Cámara
// -----------------------------------------------------------------------------
async function openCamera(): Promise<void> {
  if (cameraRestartTimer !== null) {
    window.clearTimeout(cameraRestartTimer);
    cameraRestartTimer = null;
  }
  const previous = camera;
  const next = await startCamera(settings.facing, settings.camRes);
  camera = next;
  stopStream(previous?.stream);

  video.srcObject = next.stream;
  video.classList.toggle('mirrored', next.facing === 'user');
  await video.play();

  next.track.addEventListener('ended', () => {
    if (camera !== next || !running) return;
    toast('La cámara se detuvo. Reintentando…');
    scheduleCameraRestart();
  });

  engine?.resetTracking();
  tracks = [];
  hub?.replaceRawTrack(next.track);
}

function scheduleCameraRestart(): void {
  if (cameraRestartTimer !== null) return;
  cameraRestartTimer = window.setTimeout(() => {
    cameraRestartTimer = null;
    if (!running || document.visibilityState !== 'visible') return;
    openCamera().catch(() => scheduleCameraRestart());
  }, 2000);
}

async function flipCamera(): Promise<void> {
  const previous: Facing = settings.facing;
  settings.facing = camera?.facing === 'user' ? 'environment' : 'user';
  try {
    await openCamera();
    saveSettings(settings);
  } catch (err) {
    settings.facing = previous;
    toast(err instanceof CameraError ? err.message : 'No se pudo cambiar de cámara.');
  }
}

// -----------------------------------------------------------------------------
// Motor de IA y hub WebRTC
// -----------------------------------------------------------------------------
function createEngine(): PoseEngine {
  return new PoseEngine({
    targetFps: settings.targetFps,
    maxPoses: settings.maxPoses,
    onTracks: (t, s) => {
      tracks = t;
      stats = s;
      if (hub?.wantsTracks() && video.videoWidth > 0) {
        hub.broadcastTracks(
          encodeTracks(t, {
            ts: performance.now(),
            w: video.videoWidth,
            h: video.videoHeight,
            mirror: settings.mirrorOutput,
          }),
        );
      }
    },
    onError: (message, fatal) => {
      if (fatal) toast(`Error del motor de IA: ${message}`, 8000);
    },
  });
}

function createHub(): StreamHub {
  return new StreamHub({
    id: streamId,
    peerOptions: buildPeerOptions(signalingForLinks()),
    getRawStream: () => camera?.stream ?? null,
    getComposedStream: () => compositor.getStream(30),
    onStatus: (s) => {
      hubStatus = s;
      renderLinkStatus();
    },
  });
}

function restartHub(): void {
  hub?.close();
  hub = createHub();
  hub.setVideoBitrate(bitrateFor(settings.outLong));
  hub.open();
  renderLinks();
}

// -----------------------------------------------------------------------------
// Bucle de fotogramas
// -----------------------------------------------------------------------------
function scheduleNext(): void {
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(onFrame);
}

function onFrame(): void {
  if (!running) return;
  engine?.submit(video, performance.now());
  drawDisplay();
  if (hub?.wantsComposed()) {
    compositor.draw(video, tracks, overlayOptions(settings.mirrorOutput), settings.outLong, settings.mirrorOutput);
  }
  scheduleNext();
}

function resizeCanvasIfNeeded(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = overlay.clientWidth;
  const cssH = overlay.clientHeight;
  if (cssW === canvasCssW && cssH === canvasCssH && overlay.width > 0) return;
  canvasCssW = cssW;
  canvasCssH = cssH;
  overlay.width = Math.max(1, Math.round(cssW * dpr));
  overlay.height = Math.max(1, Math.round(cssH * dpr));
}

function drawDisplay(): void {
  if (!ctx) return;
  resizeCanvasIfNeeded();
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (video.videoWidth === 0 || tracks.length === 0) return;
  const vp = fitViewport(video.videoWidth, video.videoHeight, overlay.width, overlay.height, 'contain');
  drawOverlay(ctx, vp, tracks, overlayOptions(camera?.facing === 'user'));
}

// -----------------------------------------------------------------------------
// HUD y enlaces
// -----------------------------------------------------------------------------
function updateHud(): void {
  if (!running) return;
  const s = stats;
  chipFps.textContent = s ? `${s.fps.toFixed(0)} fps · ${s.inferMs.toFixed(0)} ms` : '-- fps';
  chipFps.className = `chip ${s ? (s.fps >= 24 ? 'ok' : s.fps >= 14 ? 'warn' : 'bad') : ''}`;
  chipRes.textContent = s
    ? `${video.videoWidth}×${video.videoHeight} · IA ${s.inferSize}px ${s.delegate}`
    : `${video.videoWidth}×${video.videoHeight}`;
  chipPpl.textContent = `${tracks.length} pers.`;

  const st = hubStatus;
  if (st.signaling === 'ready') {
    chipLink.textContent = st.receivers > 0 ? `● ${st.receivers} receptor${st.receivers > 1 ? 'es' : ''}` : '● Enlace listo';
    chipLink.className = 'chip ok';
  } else if (st.signaling === 'error') {
    chipLink.textContent = '● Sin enlace';
    chipLink.className = 'chip bad';
  } else {
    chipLink.textContent = '● Conectando…';
    chipLink.className = 'chip warn';
  }
}

const MODE_DESC: Record<Mode, string> = {
  video: 'Cámara con esqueleto, IDs y métricas ya integrados. La opción más simple: una sola fuente en vMix.',
  overlay:
    'Solo los gráficos sobre fondo transparente. Colócalo encima de otra fuente de vMix con la misma proporción (16:9).',
  raw: 'Imagen de la cámara sin ningún gráfico.',
};

function renderLinks(): void {
  linkList.replaceChildren();
  for (const mode of MODES) {
    const url = buildReceiverUrl(location.href, streamId, mode, signalingForLinks());

    const item = document.createElement('div');
    item.className = 'link-item';
    item.dataset.mode = mode;

    const name = document.createElement('div');
    name.className = 'name';
    const label = document.createElement('span');
    label.textContent = MODE_LABELS[mode];
    const count = document.createElement('span');
    count.className = 'count';
    count.dataset.count = mode;
    name.append(label, count);

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = MODE_DESC[mode];

    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.value = url;
    input.setAttribute('aria-label', `URL para ${MODE_LABELS[mode]}`);
    input.addEventListener('focus', () => input.select());

    const actions = document.createElement('div');
    actions.className = 'actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn';
    copy.textContent = 'Copiar';
    copy.addEventListener('click', () => void copyText(url, input));
    actions.append(copy);

    if (typeof navigator.share === 'function') {
      const share = document.createElement('button');
      share.type = 'button';
      share.className = 'btn';
      share.textContent = 'Compartir';
      share.addEventListener('click', () => {
        navigator.share({ title: `vMix · ${MODE_LABELS[mode]}`, url }).catch(() => undefined);
      });
      actions.append(share);
    }

    item.append(name, desc, input, actions);
    linkList.append(item);
  }
  renderLinkStatus();
}

function renderLinkStatus(): void {
  const st = hubStatus;
  if (st.signaling === 'ready') {
    linkStatus.textContent =
      st.receivers > 0
        ? `● Enlace activo · ${st.receivers} receptor${st.receivers > 1 ? 'es' : ''} conectado${st.receivers > 1 ? 's' : ''}`
        : '● Enlace activo · esperando a vMix';
    linkStatus.className = 'status-line ok';
  } else if (st.signaling === 'error') {
    linkStatus.textContent = st.message ?? 'Error de conexión.';
    linkStatus.className = 'status-line bad';
  } else {
    linkStatus.textContent = st.message ?? 'Conectando con el servidor de señalización…';
    linkStatus.className = 'status-line';
  }
  for (const mode of MODES) {
    const el = linkList.querySelector<HTMLElement>(`[data-count="${mode}"]`);
    if (el) el.textContent = st.byMode[mode] > 0 ? `${st.byMode[mode]} conectado${st.byMode[mode] > 1 ? 's' : ''}` : '';
  }
}

async function copyText(text: string, input: HTMLInputElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Enlace copiado');
  } catch {
    input.focus();
    input.select();
    const ok = document.execCommand('copy');
    toast(ok ? 'Enlace copiado' : 'Mantén pulsado el texto para copiarlo');
  }
}

// -----------------------------------------------------------------------------
// Hojas (enlace / ajustes)
// -----------------------------------------------------------------------------
function openSheet(sheet: HTMLElement): void {
  sheetLink.hidden = true;
  sheetSettings.hidden = true;
  sheet.hidden = false;
}
function closeSheets(): void {
  sheetLink.hidden = true;
  sheetSettings.hidden = true;
}

document.querySelectorAll<HTMLElement>('[data-close]').forEach((el) => el.addEventListener('click', closeSheets));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheets();
});

function bindSelect<K extends 'camRes' | 'maxPoses' | 'targetFps' | 'outLong'>(
  id: string,
  key: K,
  parse: (v: string) => Settings[K],
  onChange: () => void,
): void {
  const el = $<HTMLSelectElement>(id);
  el.value = String(settings[key]);
  el.addEventListener('change', () => {
    settings[key] = parse(el.value);
    saveSettings(settings);
    onChange();
  });
}

function bindCheck(
  id: string,
  key: 'skeleton' | 'points' | 'ids' | 'metrics' | 'bbox' | 'mirrorOutput' | 'stun',
  onChange: () => void = () => undefined,
): void {
  const el = $<HTMLInputElement>(id);
  el.checked = settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    saveSettings(settings);
    onChange();
  });
}

function bindSettings(): void {
  bindSelect('set-cam-res', 'camRes', (v) => v as CamRes, () => {
    openCamera().catch((err) => toast(err instanceof CameraError ? err.message : 'No se pudo aplicar la resolución.'));
  });
  bindSelect('set-poses', 'maxPoses', Number, () => engine?.setMaxPoses(settings.maxPoses));
  bindSelect('set-fps', 'targetFps', Number, () => engine?.setTargetFps(settings.targetFps));
  bindSelect('set-out', 'outLong', Number, () => hub?.setVideoBitrate(bitrateFor(settings.outLong)));

  bindCheck('set-skeleton', 'skeleton');
  bindCheck('set-points', 'points');
  bindCheck('set-ids', 'ids');
  bindCheck('set-metrics', 'metrics');
  bindCheck('set-bbox', 'bbox');
  bindCheck('set-mirror-out', 'mirrorOutput');
  bindCheck('set-stun', 'stun', () => {
    restartHub();
    toast('Opción de red cambiada: copia de nuevo los enlaces para vMix.', 6000);
  });
}

// -----------------------------------------------------------------------------
// Pantalla completa, wake lock, PWA
// -----------------------------------------------------------------------------
async function toggleFullscreen(): Promise<void> {
  const root = document.documentElement;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (root.requestFullscreen) await root.requestFullscreen();
    else toast('En iPhone: Compartir → "Añadir a pantalla de inicio" para usarla a pantalla completa.', 6000);
  } catch {
    toast('El navegador no permitió la pantalla completa.');
  }
}

async function acquireWakeLock(): Promise<void> {
  try {
    await wakeLock?.release().catch(() => undefined);
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null; // no es crítico
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !running) return;
  void acquireWakeLock();
  if (camera?.track.readyState === 'ended') scheduleCameraRestart();
});

function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}

// -----------------------------------------------------------------------------
// Arranque
// -----------------------------------------------------------------------------
function unsupportedReason(): string | null {
  if (typeof Worker === 'undefined') return 'Este navegador no soporta Web Workers.';
  if (typeof WebAssembly === 'undefined') return 'Este navegador no soporta WebAssembly.';
  if (typeof createImageBitmap !== 'function') return 'Este navegador no soporta createImageBitmap.';
  return null;
}

async function start(): Promise<void> {
  const reason = unsupportedReason();
  if (reason) {
    startMsg.textContent = reason;
    startMsg.className = 'msg error';
    return;
  }
  btnStart.disabled = true;
  startMsg.className = 'msg';
  try {
    startMsg.textContent = 'Abriendo cámara…';
    await openCamera();

    startMsg.textContent = 'Cargando modelo de IA (solo la primera vez tarda)…';
    engine = createEngine();
    await engine.start();

    hub = createHub();
    hub.setVideoBitrate(bitrateFor(settings.outLong));
    hub.open();

    bindSettings();
    renderLinks();

    startScreen.hidden = true;
    hud.hidden = false;
    controls.hidden = false;
    running = true;
    scheduleNext();
    window.setInterval(updateHud, 500);
    void acquireWakeLock();
    toast('Listo. Toca "Enlace vMix" para copiar la URL.', 5000);
  } catch (err) {
    engine?.dispose();
    engine = null;
    stopStream(camera?.stream);
    camera = null;
    startMsg.textContent = err instanceof CameraError ? err.message : `No se pudo iniciar: ${String((err as Error)?.message ?? err)}`;
    startMsg.className = 'msg error';
    btnStart.disabled = false;
  }
}

btnStart.addEventListener('click', () => void start());
$('btn-flip').addEventListener('click', () => void flipCamera());
$('btn-link').addEventListener('click', () => {
  renderLinks();
  openSheet(sheetLink);
});
$('btn-settings').addEventListener('click', () => openSheet(sheetSettings));
$('btn-full').addEventListener('click', () => void toggleFullscreen());
$('btn-rotate').addEventListener('click', () => {
  if (!window.confirm('Se generará un enlace nuevo y los enlaces anteriores dejarán de funcionar. ¿Continuar?')) return;
  streamId = persistStreamId(generateStreamId());
  restartHub();
  toast('Enlace nuevo generado. Actualiza la URL en vMix.', 6000);
});

registerServiceWorker();
