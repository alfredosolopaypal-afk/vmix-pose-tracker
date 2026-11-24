# Arquitectura

## Visión general

```
┌──────────────────────────── MÓVIL (PWA, HTTPS) ────────────────────────────┐
│                                                                            │
│  getUserMedia ──► <video> ──┬─► [captura reducida] ──► Web Worker          │
│  (frontal/trasera)          │        256–640 px        MediaPipe Pose      │
│                             │                          Landmarker (WASM)   │
│                             │                                │             │
│                             │                          poses (landmarks)   │
│                             │                                ▼             │
│                             │                     PoseTracker (IDs, One    │
│                             │                     Euro, métricas)          │
│                             │                                │ tracks      │
│            ┌────────────────┴────────────┬───────────────────┤             │
│            ▼                             ▼                   ▼             │
│     Canvas transparente          Compositor (canvas   DataChannel JSON     │
│     (vista en pantalla)          video + overlay →    (solo modo overlay)  │
│                                  captureStream)                            │
│                                         │                   │              │
│                                         └─────► StreamHub (PeerJS) ◄───────┘
└────────────────────────────────────────────────┬───────────────────────────┘
                                                 │ WebRTC P2P cifrado (LAN)
                                                 ▼
┌────────────────────────────── PC con vMix ─────────────────────────────────┐
│  Input "Web Browser" ► receiver.html?id=…&mode=video|overlay|raw           │
│     video/raw: <video> con el MediaStream                                  │
│     overlay:   canvas transparente dibujado con los tracks recibidos       │
└────────────────────────────────────────────────────────────────────────────┘

      Señalización (solo SDP/ICE): PeerJS Cloud o servidor propio
```

## Decisiones clave

**¿Por qué un enlace WebRTC y no NDI?** Los navegadores no pueden emitir NDI ni crear cámaras virtuales. La fuente *Web Browser* de vMix (Chromium) sí soporta WebRTC, así que el receptor es una página web normal. vMix puede después reemitir esa entrada por NDI si hace falta.

**¿Por qué PeerJS?** Aporta señalización lista para usar y evita tener backend propio. El hub está aislado en `stream-hub.ts`; cambiarlo por otra señalización no afecta al resto.

**Tres modos por enlace.** El receptor declara el modo en los metadatos de la conexión de datos. El emisor responde según el modo:
- `video`: llama con el stream del compositor (cámara + overlay en un canvas).
- `raw`: llama con el stream directo de la cámara (sin coste de composición).
- `overlay`: no hay llamada de video; solo viajan los tracks por DataChannel (~3 KB por mensaje con 4 personas) y el receptor dibuja con la misma función `drawOverlay`.
El compositor solo dibuja si hay algún receptor `video` conectado.

**Un único código de render.** `core/render.ts` se usa en la pantalla del móvil, en el compositor y en el receptor. Las medidas escalan con el alto, por lo que se ve igual en todos.

**Contrapresión y calidad adaptativa.** `PoseEngine.submit` envía un frame solo si no hay otro en vuelo y respeta el FPS objetivo. `AdaptiveQuality` ajusta el lado largo de la imagen del modelo con histéresis (baja rápido, sube despacio).

**Tracking.** Asociación voraz por coste (IoU de la caja predicha + distancia de centros). Un track nuevo necesita `minHits` frames antes de recibir ID (evita IDs fantasma), y se conserva `maxLostMs` tras perderse (oclusiones breves). Los landmarks pasan por un filtro One Euro por coordenada.

**Límite conocido del tracking:** el ID se basa en posición/movimiento, no en apariencia. Si dos personas se cruzan o se ocultan mutuamente, los IDs pueden intercambiarse. No hay re-identificación facial ni de ropa, deliberadamente (privacidad y coste).

**Privacidad.** Modelo y WASM se sirven desde el mismo origen. `iceServers` vacío por defecto → sin STUN/TURN de terceros y sin relé.

## Módulos

| Módulo | Responsabilidad |
|---|---|
| `core/tracker.ts` | Asociación, IDs, velocidad/dirección, manos levantadas |
| `core/oneEuro.ts` | Suavizado de landmarks |
| `core/metrics.ts` | BBox, IoU, velocidad, flechas de dirección |
| `core/adaptive.ts` | Escalera de resolución con histéresis |
| `core/protocol.ts` | Modos, codificación compacta de tracks, ID del enlace, URLs |
| `core/peer-config.ts` | Opciones de PeerJS sin relés |
| `core/render.ts` | Esqueleto, IDs, métricas; cálculo del viewport |
| `workers/pose.worker.ts` | MediaPipe en worker; GPU → CPU automático |
| `sender/pose-engine.ts` | Captura reducida, envío al worker, tracker, estadísticas |
| `sender/camera.ts` | Permisos, frontal/trasera, errores legibles |
| `sender/compositor.ts` | Canvas video+overlay → `captureStream` |
| `sender/stream-hub.ts` | PeerJS, modos, bitrate, reconexión |
| `receiver/main.ts` | Página de vMix: conexión, reconexión, overlay |

## Ampliar el caso de uso

El tracker y el protocolo son independientes de MediaPipe. Para cambiar a manos, rostros u objetos genéricos: sustituye `PoseLandmarker` en `workers/pose.worker.ts` por el *task* correspondiente y adapta la conversión a `Pose[]`; `render.ts` necesitaría sus propias conexiones.
