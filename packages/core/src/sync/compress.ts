/**
 * gzip with the platform's own CompressionStream (browsers, Node 18+): no library. Prompts,
 * answers and context are text, which usually shrinks to a third or a fifth, so the free plan's
 * 8 MB per saved copy and 256 KB per realtime message carry several times more.
 *
 * Saved copies start with a 4-byte marker so older, uncompressed copies still load.
 */
export const PACKED_MAGIC = new Uint8Array([0x50, 0x41, 0x5a, 0x31]); // "PAZ1"

export function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** Runs bytes through a (de)compression stream with no Blob or Response (not everywhere). */
async function through(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const writing = writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
  }
  await writing;
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream('gzip'));
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream('gzip'));
}

function startsWithMagic(bytes: Uint8Array): boolean {
  return PACKED_MAGIC.every((b, i) => bytes[i] === b);
}

/** A saved copy as stored: marker + gzip, or the bytes unchanged when that is not smaller. */
export async function packState(state: Uint8Array): Promise<Uint8Array> {
  if (!canCompress() || state.length < 256) return state;
  const zipped = await gzip(state);
  if (zipped.length + PACKED_MAGIC.length >= state.length) return state;
  const out = new Uint8Array(PACKED_MAGIC.length + zipped.length);
  out.set(PACKED_MAGIC, 0);
  out.set(zipped, PACKED_MAGIC.length);
  return out;
}

/** The document update inside a saved copy (old copies pass through as they are). */
export async function unpackState(stored: Uint8Array): Promise<Uint8Array> {
  if (!startsWithMagic(stored)) return stored;
  return gunzip(stored.subarray(PACKED_MAGIC.length));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
