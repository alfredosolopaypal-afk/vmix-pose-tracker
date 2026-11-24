import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/sender/settings';

describe('sanitizeSettings', () => {
  it('devuelve los valores por defecto con entrada vacía o inválida', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('basura')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ maxPoses: 99, targetFps: 'rápido', facing: 'lado' })).toEqual(DEFAULT_SETTINGS);
  });

  it('acepta valores válidos y descarta señalización inválida', () => {
    const s = sanitizeSettings({
      maxPoses: 3,
      targetFps: 15,
      facing: 'user',
      stun: true,
      signaling: { peerHost: 'mi.host', peerPort: 5, peerPath: '/x' },
    });
    expect(s.maxPoses).toBe(3);
    expect(s.targetFps).toBe(15);
    expect(s.facing).toBe('user');
    expect(s.stun).toBe(true);
    expect(s.signaling).toEqual({ peerHost: 'mi.host', peerPath: '/x' });
  });
});
