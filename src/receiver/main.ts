import Peer, { type DataConnection, type MediaConnection } from 'peerjs';
import { buildPeerOptions } from '../core/peer-config';
import {
  decodeTracks,
  isTracksMessage,
  isValidStreamId,
  parseMode,
  signalingFromParams,
  type Mode,
} from '../core/protocol';
import { drawOverlay, fitViewport, type OverlayOptions } from '../core/render';
import type { Fit } from '../core/types';
import './receiver.css';

/**
 * Página receptora para vMix (Add Input → Web Browser).
 *
 * Parámetros de la URL:
 *   id        (obligatorio) identificador del emisor, lo da la app del móvil
 *   mode      video | overlay | raw   (por defecto video)
 *   fit       contain | cover | stretch
 *   bg        transparent | hex sin '#' (p. ej. 00ff00 para croma)
 *   skeleton, points, ids, metrics, bbox  = 0|1   (solo modo overlay)
 *   debug=1   muestra el estado de la conexión sobre la imagen
 *   stun=1, peerHost, peerPort, peerPath, peerSecure   (red / señalización)
 */
const params = new URLSearchParams(location.search);
const streamId = params.get('id');
const mode: Mode = parseMode(params.get('mode'));
const debug = params.get('debug') === '1';
const signaling = signalingFromParams(params);

const fitParam = params.get('fit');
const fit: Fit = fitParam === 'cover' || fitParam === 'stretch' || fitParam === 'contain' ? fitParam : 'contain';

const flag = (name: string, fallback: boolean): boolean => {
  const v = params.get(name);
  return v === null ? fallback : v === '1' || v === 'true';
};
const overlayOpts: OverlayOptions = {
  skeleton: flag('skeleton', true),
  points: flag('points', true),
  bbox: flag('bbox', false),
  ids: flag('ids', true),
  metrics: flag('metrics', true),
  mirror: false,
};

const video = document.getElementById('v') as HTMLVideoElement;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLElement;
const ctx = canvas.getContext('2d');

// Fondo: transparente en overlay (vMix respeta el canal alfa del navegador); negro en video.
const bg = params.get('bg');
if (bg && bg !== 'transparent' && /^[0-9a-fA-F]{3,8}$/.test(bg)) document.body.style.background = `#${bg}`;
else document.body.style.background = mode === 'overlay' ? 'transparent' : '#000';

video.style.objectFit = fit === 'stretch' ? 'fill' : fit;
if (mode === 'overlay') video.hidden = true;
else canvas.hidden = true;

function setStatus(text: string, force = false): void {
  if (!debug && !force) return;
  statusEl.textContent = text;
  statusEl.hidden = false;
}

// -----------------------------------------------------------------------------
// Conexión con reconexión automática
// -----------------------------------------------------------------------------
let peer: Peer | null = null;
let dataConn: DataConnection | null = null;
let call: MediaConnection | null = null;
let retryTimer: number | null = null;
let lastProgressAt = performance.now();
let lastVideoTime = -1;
let lastDataAt = 0;
let messages = 0;

function teardown(): void {
  call?.close();
  dataConn?.close();
  peer?.destroy();
  call = null;
  dataConn = null;
  peer = null;
  video.srcObject = null;
  clearOverlay();
}

function reconnectSoon(reason: string): void {
  if (retryTimer !== null) return;
  setStatus(`${reason} · reintentando…`);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    connect();
  }, 2500);
}

function connect(): void {
  if (!isValidStreamId(streamId)) return;
  teardown();
  lastProgressAt = performance.now();
  lastVideoTime = -1;
  setStatus('Conectando con el emisor…');

  const p = new Peer(buildPeerOptions(signaling));
  peer = p;

  p.on('open', () => {
    const conn = p.connect(streamId, { metadata: { mode }, serialization: 'json', reliable: false });
    dataConn = conn;
    conn.on('open', () => {
      setStatus(mode === 'overlay' ? 'Conectado · recibiendo datos' : 'Conectado · esperando video…');
      lastProgressAt = performance.now();
    });
    conn.on('data', onData);
    conn.on('close', () => reconnectSoon('Conexión cerrada'));
    conn.on('error', () => reconnectSoon('Error en la conexión de datos'));
  });

  p.on('call', (c) => {
    call = c;
    c.answer(); // solo recibimos: no enviamos video
    c.on('stream', (stream) => attach(stream, c));
    c.on('close', () => reconnectSoon('Video cerrado'));
    c.on('error', () => reconnectSoon('Error en el video'));
  });

  p.on('disconnected', () => {
    // Se perdió solo la señalización: la conexión P2P activa no se ve afectada.
    if (!p.destroyed) p.reconnect();
  });

  p.on('error', (err) => {
    const type = String((err as { type?: string }).type ?? 'desconocido');
    if (type === 'peer-unavailable') reconnectSoon('Esperando al emisor (¿está abierta la app en el móvil?)');
    else reconnectSoon(`Error (${type})`);
  });
}

function attach(stream: MediaStream, c: MediaConnection): void {
  video.srcObject = stream;
  video.muted = true;
  video.play().catch(() => undefined);
  setStatus('Recibiendo video');
  lowLatency(c);
}

/** Pide al navegador el mínimo buffer de reproducción (menos latencia, a costa de algo de robustez). */
function lowLatency(c: MediaConnection): void {
  for (const r of c.peerConnection?.getReceivers() ?? []) {
    if (r.track.kind !== 'video') continue;
    const rx = r as RTCRtpReceiver & { playoutDelayHint?: number; jitterBufferTarget?: number | null };
    try {
      rx.playoutDelayHint = 0;
    } catch {
      /* no soportado */
    }
    try {
      rx.jitterBufferTarget = 0;
    } catch {
      /* no soportado */
    }
  }
}

// -----------------------------------------------------------------------------
// Overlay (modo overlay): dibujado local con los datos recibidos
// -----------------------------------------------------------------------------
let lastMsg: ReturnType<typeof decodeTracks> | null = null;

function onData(data: unknown): void {
  if (!isTracksMessage(data)) return;
  lastDataAt = performance.now();
  lastProgressAt = lastDataAt;
  messages++;
  lastMsg = decodeTracks(data);
  drawOverlayFrame();
  if (debug && messages % 30 === 0) setStatus(`Overlay · ${lastMsg.tracks.length} personas · ${messages} mensajes`);
}

function sizeCanvas(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(window.innerWidth * dpr));
  const h = Math.max(1, Math.round(window.innerHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function clearOverlay(): void {
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawOverlayFrame(): void {
  if (!ctx || !lastMsg || mode !== 'overlay') return;
  sizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const vp = fitViewport(lastMsg.w, lastMsg.h, canvas.width, canvas.height, fit);
  drawOverlay(ctx, vp, lastMsg.tracks, { ...overlayOpts, mirror: lastMsg.mirror });
}

window.addEventListener('resize', drawOverlayFrame);

// -----------------------------------------------------------------------------
// Vigilante: reconecta si no hay progreso (emisor dormido, red caída...)
// -----------------------------------------------------------------------------
window.setInterval(() => {
  if (!isValidStreamId(streamId) || retryTimer !== null) return;
  const now = performance.now();

  if (mode === 'overlay') {
    if (lastMsg && now - lastDataAt > 1500) {
      lastMsg = null; // no dejar un esqueleto congelado si el emisor se detuvo
      clearOverlay();
    }
  } else if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    lastProgressAt = now;
  }

  if (now - lastProgressAt > 10_000) {
    lastProgressAt = now;
    reconnectSoon('Sin señal');
  }
}, 1000);

// -----------------------------------------------------------------------------
// Arranque
// -----------------------------------------------------------------------------
if (!isValidStreamId(streamId)) {
  setStatus('Falta el parámetro "id" en la URL. Copia el enlace completo desde la app del móvil.', true);
} else {
  connect();
}
