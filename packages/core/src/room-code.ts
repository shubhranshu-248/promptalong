/**
 * Room codes: 6 characters from Crockford's base32 alphabet with 0 removed as well
 * (no I, L, O, U, 0), so codes are easy to read aloud and type. 31^6 ≈ 887 million codes.
 */
export const ROOM_CODE_ALPHABET = '123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ROOM_CODE_LENGTH = 6;

const VALID = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`, 'u');

type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => void;

const defaultRandom: RandomSource = (bytes) => {
  crypto.getRandomValues(bytes);
};

/** A new random room code. Uses rejection sampling so every character is equally likely. */
export function createRoomCode(random: RandomSource = defaultRandom): string {
  const n = ROOM_CODE_ALPHABET.length;
  const limit = 256 - (256 % n); // largest multiple of n below 256
  let code = '';
  const buf = new Uint8Array(16);
  while (code.length < ROOM_CODE_LENGTH) {
    random(buf);
    for (const byte of buf) {
      if (byte < limit && code.length < ROOM_CODE_LENGTH)
        code += ROOM_CODE_ALPHABET.charAt(byte % n);
    }
  }
  return code;
}

/**
 * Cleans what a person typed: upper-cases, drops spaces and dashes, and maps the look-alikes
 * I and L to 1. Returns null when the result is not a valid code.
 */
export function normalizeRoomCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/gu, '').replace(/[IL]/gu, '1');
  return VALID.test(cleaned) ? cleaned : null;
}

export function isRoomCode(value: string): boolean {
  return VALID.test(value);
}

/** "K7QM2X" -> "K7Q-M2X", easier to read out loud. */
export function formatRoomCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
