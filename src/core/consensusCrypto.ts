import type { GameState } from './ottEngine';

/**
 * Cryptographic helpers for the OTTv2 P2P ECDSA P-256 consensus protocol.
 * Compatible with server/src/replay.js verification.
 */

const encoder = new TextEncoder();

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(rec)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalize(rec[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

export function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2) throw new Error('Invalid hex data');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function digest(payload: unknown): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalize(payload)));
  return toHex(buf);
}

export interface ConsensusIdentity {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
}

export async function generateIdentity(): Promise<ConsensusIdentity> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  return { privateKey: keys.privateKey, publicKey: keys.publicKey, publicJwk };
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'verify',
  ]);
}

export async function hashState(state: GameState): Promise<string> {
  return digest({
    board: Array.from(state.board),
    turn: state.turn,
    stepCount: state.stepCount,
    winner: state.winner === 0 ? 0 : state.winner || null,
    seed: state.seed,
    pieceCount: state.pieceCount,
    lastMove: state.lastMove || null,
    ...(state.rules ? { rules: state.rules } : {}),
  });
}

export async function hashMove(payload: unknown): Promise<string> {
  return digest(payload);
}

export function createNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function signPayload(identity: ConsensusIdentity, payload: unknown): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    encoder.encode(canonicalize(payload))
  );
  return toHex(signature);
}

export async function verifyPayload(
  publicKey: CryptoKey,
  payload: unknown,
  signature: string
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromHex(signature) as BufferSource,
      encoder.encode(canonicalize(payload))
    );
  } catch {
    return false;
  }
}
