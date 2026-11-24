import { ROOM_CODE_ALPHABET } from '@promptalong/core';

const ALLOWED = new Set(ROOM_CODE_ALPHABET.split(''));

/** Cleans one typed character: upper-case, I/L read as 1. Returns '' if it can never be in a code. */
export function cleanCodeChar(ch: string): string {
  const up = ch.toUpperCase().replace(/[IL]/u, '1');
  return ALLOWED.has(up) ? up : '';
}
