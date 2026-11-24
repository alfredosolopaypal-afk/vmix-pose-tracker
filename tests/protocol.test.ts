import { describe, expect, it } from 'vitest';
import {
  buildReceiverUrl,
  decodeTracks,
  encodeTracks,
  generateStreamId,
  isTracksMessage,
  isValidStreamId,
  parseMode,
  signalingFromParams,
} from '../src/core/protocol';
import { PoseTracker } from '../src/core/tracker';
import { makePose } from './helpers';

describe('protocolo', () => {
  it('parseMode cae a "video" con valores inválidos', () => {
    expect(parseMode('overlay')).toBe('overlay');
    expect(parseMode('raw')).toBe('raw');
    expect(parseMode('xx')).toBe('video');
    expect(parseMode(null)).toBe('video');
  });

  it('encode/decode conserva IDs, métricas y posiciones (con redondeo)', () => {
    const t = new PoseTracker();
    let tracks = t.update([makePose(0.4, 0.5)], 0);
    // El suavizado One Euro tarda unos frames en reflejar un cambio brusco (la mano sube).
    for (let i = 1; i <= 20; i++) {
      tracks = t.update([makePose(0.4, 0.5, 0.5, { rightHandUp: true })], i * 33);
    }
    expect(tracks).toHaveLength(1);

    const msg = encodeTracks(tracks, { ts: 1234.6, w: 1280, h: 720, mirror: true });
    expect(isTracksMessage(JSON.parse(JSON.stringify(msg)))).toBe(true);

    const back = decodeTracks(JSON.parse(JSON.stringify(msg)));
    expect(back.w).toBe(1280);
    expect(back.mirror).toBe(true);
    const a = tracks[0];
    const b = back.tracks[0];
    expect(b?.id).toBe(a?.id);
    expect(b?.landmarks).toHaveLength(33);
    expect(b?.landmarks[16]?.x).toBeCloseTo(a?.landmarks[16]?.x ?? 0, 3);
    expect(b?.handsRaised.right).toBe(true);
  });

  it('el mensaje de 4 personas cabe holgadamente en un paquete de DataChannel', () => {
    const t = new PoseTracker();
    const poses = [0.15, 0.38, 0.62, 0.85].map((x) => makePose(x, 0.5));
    let tracks = t.update(poses, 0);
    tracks = t.update(poses, 33);
    expect(tracks).toHaveLength(4);
    const size = JSON.stringify(encodeTracks(tracks, { ts: 0, w: 1280, h: 720, mirror: false })).length;
    expect(size).toBeLessThan(12_000);
  });

  it('isTracksMessage rechaza basura', () => {
    expect(isTracksMessage(null)).toBe(false);
    expect(isTracksMessage({ t: 'otra' })).toBe(false);
    expect(isTracksMessage('hola')).toBe(false);
  });

  it('generateStreamId es válido, no ambiguo y no se repite', () => {
    const a = generateStreamId();
    const b = generateStreamId();
    expect(isValidStreamId(a)).toBe(true);
    expect(a).toMatch(/^vpt-[a-hjkmnp-z2-9]{12}$/);
    expect(a).not.toBe(b);
    expect(isValidStreamId('')).toBe(false);
    expect(isValidStreamId('a b')).toBe(false);
    expect(isValidStreamId(null)).toBe(false);
  });

  it('buildReceiverUrl respeta la subcarpeta y añade parámetros de red solo si existen', () => {
    const url = buildReceiverUrl('https://usuario.github.io/mi-repo/index.html?x=1#h', 'vpt-abc123', 'overlay');
    expect(url).toBe('https://usuario.github.io/mi-repo/receiver.html?id=vpt-abc123&mode=overlay');
    const custom = buildReceiverUrl('https://x.dev/', 'vpt-abc123', 'video', {
      peerHost: 'peer.mi.red',
      peerPort: '9000',
      stun: true,
    });
    const u = new URL(custom);
    expect(u.searchParams.get('peerHost')).toBe('peer.mi.red');
    expect(u.searchParams.get('peerPort')).toBe('9000');
    expect(u.searchParams.get('stun')).toBe('1');
  });

  it('signalingFromParams lee los parámetros de señalización', () => {
    const s = signalingFromParams(new URLSearchParams('peerHost=h&peerPort=1&stun=1&otro=2'));
    expect(s).toEqual({ peerHost: 'h', peerPort: '1', stun: true });
    expect(signalingFromParams(new URLSearchParams(''))).toEqual({});
  });
});
