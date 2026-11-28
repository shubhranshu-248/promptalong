import { presenceHex } from '@promptalong/ui';

export type Activity = 'typing' | 'selecting' | 'idle' | 'sending';

/** What each person publishes about themselves (awareness field "user"). */
export interface AwarenessUser {
  pid: string;
  name: string;
  slot: number;
  /** when this visit started (slot priority) */
  joinedAt: number;
  /** hex colour, read by the editor carets */
  color: string;
  /** hex colour for text drawn on `color` */
  label: string;
}

export interface PersonView extends AwarenessUser {
  me: boolean;
  activity: Activity;
  host: boolean;
  /** the session this person has open (room presence only) */
  viewing?: string | null;
}

/** Validates another person's awareness "user" field (it comes from the network). */
export function readUser(value: unknown): AwarenessUser | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.pid !== 'string' || typeof v.name !== 'string') return null;
  if (typeof v.slot !== 'number' || typeof v.joinedAt !== 'number') return null;
  const slot = Math.min(16, Math.max(1, Math.round(v.slot)));
  return {
    pid: v.pid.slice(0, 64),
    name: v.name.slice(0, 24),
    slot,
    joinedAt: v.joinedAt,
    ...presenceHex(slot),
  };
}

export function readActivity(value: unknown): Activity {
  return value === 'typing' || value === 'selecting' ? value : 'idle';
}
