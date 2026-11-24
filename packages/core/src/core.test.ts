import {
  ROOM_CODE_ALPHABET,
  cleanDisplayName,
  createRoomCode,
  formatRoomCode,
  isRoomCode,
  normalizeRoomCode,
} from './index';

describe('room codes', () => {
  it('uses 31 unambiguous characters', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(31);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[ILOU0]/u);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(31);
  });

  it('creates valid 6-character codes', () => {
    for (let i = 0; i < 200; i++) expect(isRoomCode(createRoomCode())).toBe(true);
  });

  it('skips biased bytes (rejection sampling)', () => {
    // 248 is the first rejected byte for a 31-character alphabet; 0 maps to the first character.
    const bytes = [248, 255, 0, 1, 2, 3, 4, 5];
    const fake = (buf: Uint8Array) => {
      buf.fill(0);
      buf.set(bytes);
    };
    expect(createRoomCode(fake)).toBe('123456');
  });

  it.each([
    ['k7q-m2x', 'K7QM2X'],
    [' K7Q M2X ', 'K7QM2X'],
    ['abcdef', 'ABCDEF'],
    ['i1lhjk', '111HJK'],
  ])('normalises %j to %s', (input, expected) => {
    expect(normalizeRoomCode(input)).toBe(expected);
  });

  it.each(['', 'K7QM2', 'K7QM2XX', 'K7QM0X', 'K7QMOX', 'K7QMUX', 'K7QM!X'])(
    'rejects %j',
    (input) => {
      expect(normalizeRoomCode(input)).toBeNull();
    },
  );

  it('formats for reading aloud', () => {
    expect(formatRoomCode('K7QM2X')).toBe('K7Q-M2X');
  });
});

describe('display names', () => {
  it('trims, collapses whitespace and strips control characters', () => {
    expect(cleanDisplayName('  Aarav \u0007  Rao\n')).toBe('Aarav Rao');
  });

  it('caps at 24 characters', () => {
    expect(cleanDisplayName('x'.repeat(40))).toHaveLength(24);
  });

  it('returns null for empty input', () => {
    expect(cleanDisplayName(' \u200B \t')).toBeNull();
  });

  it('keeps non-Latin names', () => {
    expect(cleanDisplayName('शुभ्रांशु')).toBe('शुभ्रांशु');
  });
});
