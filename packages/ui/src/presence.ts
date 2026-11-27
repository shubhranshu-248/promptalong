import tokens from './tokens/tokens.json';

export const PRESENCE_SLOTS = tokens.color.presence.slots.map((s) => s.id);
export type PresenceSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;
export const MAX_PARTICIPANTS = 16;

/** CSS variables for a presence slot: the colour and the label colour drawn on it. */
export function presenceVars(slot: PresenceSlot): { color: string; label: string } {
  return { color: `var(--p-${slot})`, label: `var(--p-${slot}-label)` };
}

/** Hex values of a presence slot, for places that cannot use CSS variables (editor carets). */
export function presenceHex(slot: number): { color: string; label: string } {
  const s = tokens.color.presence.slots[Math.min(Math.max(slot, 1), 16) - 1];
  return { color: s?.value ?? '#16171D', label: s?.label ?? '#FFFFFF' };
}

/**
 * Up to two initials from a display name, e.g. "Aarav Rao" -> "AR", "meera" -> "ME".
 * Only letters and digits count, and text in brackets is skipped: "Test user (phone)" -> "TU".
 */
export function initials(name: string): string {
  const plain = name.replace(/[([{][^)\]}]*[)\]}]?/gu, ' ');
  const words = plain.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
  const firstWord = words[0];
  if (!firstWord) return '?';
  const lastWord = words.length > 1 ? words[words.length - 1] : undefined;
  const letters = Array.from(firstWord.replace(/\p{M}/gu, ''));
  const first = letters[0] ?? '';
  const second = lastWord ? (Array.from(lastWord)[0] ?? '') : (letters[1] ?? '');
  return (first + second).toUpperCase();
}
