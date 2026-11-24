import { fromBase64, toBase64 } from 'lib0/buffer';

export const encode64 = (bytes: Uint8Array): string => toBase64(bytes);
export const decode64 = (text: string): Uint8Array => fromBase64(text);
