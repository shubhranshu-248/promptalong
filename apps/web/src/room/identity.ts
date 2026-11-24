import { cleanDisplayName, randomId } from '@promptalong/core';
import { safeStorage } from './storage';

const PID_KEY = 'promptalong:pid';
const NAME_KEY = 'promptalong:name';
let memoryPid: string | null = null;

/** This browser's participant id (ADR-008; replaced by the auth uid in P6). */
export function getPid(): string {
  const stored = safeStorage.get(PID_KEY);
  if (stored && /^[a-f0-9]{8,64}$/u.test(stored)) return stored;
  memoryPid ??= randomId();
  safeStorage.set(PID_KEY, memoryPid);
  return memoryPid;
}

export function getDisplayName(): string | null {
  const stored = safeStorage.get(NAME_KEY);
  return stored ? cleanDisplayName(stored) : null;
}

export function saveDisplayName(name: string): string | null {
  const clean = cleanDisplayName(name);
  if (clean) safeStorage.set(NAME_KEY, clean);
  return clean;
}
