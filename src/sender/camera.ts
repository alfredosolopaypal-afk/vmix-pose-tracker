import type { CamRes, Facing } from './settings';

export type CameraErrorCode = 'insecure' | 'unsupported' | 'denied' | 'not-found' | 'in-use' | 'unknown';

export class CameraError extends Error {
  constructor(
    public readonly code: CameraErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

export interface CameraHandle {
  stream: MediaStream;
  track: MediaStreamTrack;
  width: number;
  height: number;
  facing: Facing;
}

const RES: Record<CamRes, { w: number; h: number }> = {
  auto: { w: 1280, h: 720 },
  '480': { w: 640, h: 480 },
  '720': { w: 1280, h: 720 },
  '1080': { w: 1920, h: 1080 },
};

function mapError(err: unknown): CameraError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'denied',
        'Permiso de cámara denegado. Actívalo en los ajustes del navegador para este sitio y vuelve a intentarlo.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not-found', 'No se encontró una cámara compatible en este dispositivo.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('in-use', 'La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo.');
    default:
      return new CameraError('unknown', `No se pudo abrir la cámara (${name || 'error desconocido'}).`);
  }
}

/** Abre la cámara pedida (frontal/trasera) con resolución y 30 fps ideales. */
export async function startCamera(facing: Facing, camRes: CamRes): Promise<CameraHandle> {
  if (!window.isSecureContext) {
    throw new CameraError('insecure', 'La cámara solo funciona en HTTPS (o localhost). Abre la app con una dirección https://.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', 'Este navegador no permite acceder a la cámara.');
  }

  const size = RES[camRes];
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: size.w },
        height: { ideal: size.h },
        frameRate: { ideal: 30, max: 30 },
      },
    },
    { audio: false, video: { facingMode: { ideal: facing } } },
    { audio: false, video: true },
  ];

  let lastErr: unknown;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      if (!track) throw new CameraError('not-found', 'El dispositivo no entregó vídeo.');
      const s = track.getSettings();
      return {
        stream,
        track,
        width: s.width ?? 0,
        height: s.height ?? 0,
        facing: (s.facingMode as Facing | undefined) ?? facing,
      };
    } catch (err) {
      lastErr = err;
      // Si el usuario negó el permiso no tiene sentido relajar restricciones.
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') break;
    }
  }
  throw lastErr instanceof CameraError ? lastErr : mapError(lastErr);
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}
