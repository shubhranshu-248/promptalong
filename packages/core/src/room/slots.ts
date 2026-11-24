/**
 * Colour slots (1-8) are handed out in join order. Every browser decides only its OWN slot from what
 * it sees, with one tie-break rule everyone shares, so two people who join at the same moment never
 * keep the same colour.
 */
export const SLOT_COUNT = 8;
export const MAX_PEOPLE = 8;

export interface PresentPerson {
  pid: string;
  slot: number;
  joinedAt: number;
}

/** True when `a` has priority over `b` for a contested slot (earlier join wins, then smaller id). */
export function hasPriority(a: PresentPerson, b: PresentPerson): boolean {
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt;
  return a.pid < b.pid;
}

/**
 * The slot this person should use.
 * `joinedAt` is when each person's current visit started, so a newcomer never takes a colour away
 * from someone already in the room.
 * @param me who is choosing (slot = the slot they used before, or 0 for none)
 * @param others everyone else currently present
 */
export function chooseSlot(me: PresentPerson, others: readonly PresentPerson[]): number {
  const valid = (s: number) => Number.isInteger(s) && s >= 1 && s <= SLOT_COUNT;
  const peers = others.filter((o) => o.pid !== me.pid);
  if (valid(me.slot)) {
    const rival = peers.find((o) => o.slot === me.slot && hasPriority(o, me));
    if (!rival) return me.slot;
  }
  // Slots held by people who outrank me, or who are not contesting mine.
  const taken = new Set(
    peers.filter((o) => valid(o.slot) && hasPriority(o, me)).map((o) => o.slot),
  );
  for (let s = 1; s <= SLOT_COUNT; s++) if (!taken.has(s)) return s;
  // More than 8 people: share the last colour; the full-room rule removes the extra person.
  return SLOT_COUNT;
}

/** True when this person is beyond the 8-person limit (ranked by join order). */
export function isOverCapacity(me: PresentPerson, others: readonly PresentPerson[]): boolean {
  const ahead = new Set(
    others.filter((o) => o.pid !== me.pid && hasPriority(o, me)).map((o) => o.pid),
  );
  return ahead.size >= MAX_PEOPLE;
}
