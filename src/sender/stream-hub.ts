import Peer, { type DataConnection, type MediaConnection, type PeerOptions } from 'peerjs';
import { parseMode, type Mode, type TracksMessage } from '../core/protocol';

export type SignalingState = 'idle' | 'connecting' | 'ready' | 'error';

export interface HubStatus {
  signaling: SignalingState;
  /** Mensaje legible si hay error. */
  message?: string;
  receivers: number;
  byMode: Record<Mode, number>;
}

export interface HubOptions {
  id: string;
  peerOptions: PeerOptions;
  getRawStream: () => MediaStream | null;
  getComposedStream: () => MediaStream;
  onStatus: (status: HubStatus) => void;
}

interface Entry {
  conn: DataConnection;
  mode: Mode;
  call: MediaConnection | null;
}

const RETRYABLE = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected']);

/**
 * Hub WebRTC del emisor. El receptor (página de vMix) inicia la conexión de datos indicando el modo;
 * el emisor responde llamándole con el stream que corresponda (o solo datos, en modo overlay).
 * El vídeo viaja P2P; el servidor de señalización solo ve SDP/ICE.
 */
export class StreamHub {
  private peer: Peer | null = null;
  private readonly entries = new Map<string, Entry>();
  private state: SignalingState = 'idle';
  private message: string | undefined;
  private destroyed = false;
  private retryTimer: number | null = null;
  private bitrate = 4_000_000;

  constructor(private readonly opts: HubOptions) {}

  open(): void {
    this.destroyed = false;
    this.setState('connecting');
    const peer = new Peer(this.opts.id, this.opts.peerOptions);
    this.peer = peer;

    peer.on('open', () => this.setState('ready'));

    peer.on('connection', (conn) => this.onConnection(conn));

    peer.on('disconnected', () => {
      if (this.destroyed || this.peer !== peer) return;
      this.setState('connecting', 'Reconectando con el servidor de señalización…');
      window.setTimeout(() => {
        if (!this.destroyed && this.peer === peer && !peer.destroyed) peer.reconnect();
      }, 1500);
    });

    peer.on('error', (err) => {
      if (this.destroyed || this.peer !== peer) return;
      const type = String((err as { type?: string }).type ?? '');
      if (type === 'unavailable-id') {
        this.setState('error', 'Ese enlace ya está en uso en otro dispositivo. Usa "Generar enlace nuevo".');
        return;
      }
      if (type === 'peer-unavailable') return; // un receptor se fue antes de contestar
      if (RETRYABLE.has(type)) {
        this.setState('error', 'Sin conexión con el servidor de señalización. Reintentando…');
        this.scheduleReopen();
        return;
      }
      this.setState('error', `Error de conexión (${type || 'desconocido'}).`);
    });
  }

  /** Cierra todo. */
  close(): void {
    this.destroyed = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    for (const e of this.entries.values()) {
      e.call?.close();
      e.conn.close();
    }
    this.entries.clear();
    this.peer?.destroy();
    this.peer = null;
    this.setState('idle');
  }

  /** ¿Algún receptor necesita el vídeo compuesto (cámara + overlay)? */
  wantsComposed(): boolean {
    for (const e of this.entries.values()) if (e.mode === 'video') return true;
    return false;
  }

  /** ¿Algún receptor necesita datos de tracking? */
  wantsTracks(): boolean {
    for (const e of this.entries.values()) if (e.mode === 'overlay') return true;
    return false;
  }

  broadcastTracks(msg: TracksMessage): void {
    for (const e of this.entries.values()) {
      if (e.mode !== 'overlay' || !e.conn.open) continue;
      const buffered = e.conn.dataChannel?.bufferedAmount ?? 0;
      if (buffered > 64 * 1024) continue; // el receptor va retrasado: mejor saltar un frame que acumular latencia
      e.conn.send(msg);
    }
  }

  /** Tras cambiar de cámara: sustituye la pista de vídeo de las llamadas en modo "raw". */
  replaceRawTrack(track: MediaStreamTrack): void {
    for (const e of this.entries.values()) {
      if (e.mode !== 'raw' || !e.call) continue;
      const sender = e.call.peerConnection?.getSenders().find((s) => s.track?.kind === 'video');
      sender?.replaceTrack(track).catch(() => undefined);
    }
  }

  setVideoBitrate(bps: number): void {
    this.bitrate = bps;
    for (const e of this.entries.values()) if (e.call) void this.tune(e.call);
  }

  get receiverCount(): number {
    return this.entries.size;
  }

  // ---------------------------------------------------------------------------

  private onConnection(conn: DataConnection): void {
    const mode = parseMode((conn.metadata as { mode?: unknown } | undefined)?.mode);
    const entry: Entry = { conn, mode, call: null };
    this.entries.set(conn.connectionId, entry);
    this.emit();

    conn.on('open', () => {
      if (mode === 'video' || mode === 'raw') this.startCall(entry);
      this.emit();
    });
    const drop = () => {
      entry.call?.close();
      this.entries.delete(conn.connectionId);
      this.emit();
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  private startCall(entry: Entry): void {
    const peer = this.peer;
    if (!peer || peer.destroyed) return;
    const stream = entry.mode === 'video' ? this.opts.getComposedStream() : this.opts.getRawStream();
    if (!stream) return;

    const call = peer.call(entry.conn.peer, stream, { metadata: { mode: entry.mode } });
    entry.call = call;
    call.on('close', () => {
      if (entry.call === call) entry.call = null;
    });
    const pc = call.peerConnection;
    pc?.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') void this.tune(call);
    });
  }

  /** Prioriza fluidez (mantener FPS) y fija un bitrate acorde a la resolución. */
  private async tune(call: MediaConnection): Promise<void> {
    try {
      for (const sender of call.peerConnection?.getSenders() ?? []) {
        if (sender.track?.kind !== 'video') continue;
        const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        const enc = params.encodings[0];
        if (enc) {
          enc.maxBitrate = this.bitrate;
          enc.maxFramerate = 30;
        }
        params.degradationPreference = 'maintain-framerate';
        await sender.setParameters(params);
      }
    } catch {
      /* no todos los navegadores aceptan todos los parámetros */
    }
  }

  private scheduleReopen(): void {
    if (this.retryTimer !== null || this.destroyed) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.destroyed) return;
      this.peer?.destroy();
      this.entries.clear();
      this.open();
    }, 3000);
  }

  private setState(state: SignalingState, message?: string): void {
    this.state = state;
    this.message = message;
    this.emit();
  }

  private emit(): void {
    const byMode: Record<Mode, number> = { video: 0, overlay: 0, raw: 0 };
    for (const e of this.entries.values()) byMode[e.mode]++;
    this.opts.onStatus({
      signaling: this.state,
      message: this.message,
      receivers: this.entries.size,
      byMode,
    });
  }
}
