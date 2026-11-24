import type { PeerOptions } from 'peerjs';
import type { SignalingParams } from './protocol';

export const STUN_URL = 'stun:stun.l.google.com:19302';

/**
 * Opciones de PeerJS compartidas por emisor y receptor.
 *
 * Privacidad: por defecto `iceServers` está VACÍO. Eso elimina los servidores STUN y, sobre todo,
 * el TURN que PeerJS incluye de fábrica, de modo que el vídeo solo puede viajar directo entre
 * el móvil y el equipo de vMix dentro de la misma red local. Nunca pasa por un relé.
 * Con `stun: true` se añade solo STUN (descubrir IP pública para conexiones fuera de la LAN);
 * sigue sin haber relé.
 *
 * El servidor de señalización (PeerJS Cloud por defecto) solo intercambia SDP/ICE (metadatos).
 * Puede sustituirse por uno propio con peerHost/peerPort/peerPath/peerSecure.
 */
export function buildPeerOptions(signaling: SignalingParams = {}): PeerOptions {
  const opts: PeerOptions = {
    debug: 0,
    config: { iceServers: signaling.stun ? [{ urls: STUN_URL }] : [] },
  };
  if (signaling.peerHost) {
    opts.host = signaling.peerHost;
    const port = Number(signaling.peerPort);
    opts.port = Number.isFinite(port) && port > 0 ? port : 443;
    opts.path = signaling.peerPath ?? '/';
    opts.secure = signaling.peerSecure !== '0' && signaling.peerSecure !== 'false';
  }
  return opts;
}
