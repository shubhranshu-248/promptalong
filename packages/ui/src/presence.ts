import tokens from './tokens/tokens.json';

export const PRESENCE_SLOTS = tokens.color.presence.slots.map((s) => s.id);
export type PresenceSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const MAX_PARTICIPANTS = 8;

/** CSS variables for a presence slot: the colour and the label colour drawn on it. */
export function presenceVars(slot: PresenceSlot): { color: string; label: string } {
  return { color: `var(--p-${slot})`, label: `var(--p-${slot}-label)` };
}

/** Up to two initials from a display name, e.g. "Aarav Rao" -> "AR". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : (words[0]?.[1] ?? '');
  return (first + second).toUpperCase();
}
