import { MemoryHub } from '@promptalong/core';
import { LOCAL_SESSION_ID, type RoomSession } from '../room/session';
import type { SessionConn } from '../room/session-conn';

const sessionHubs = new WeakMap<MemoryHub, MemoryHub>();

/** The in-page channel of the one session of a test room (one per room channel). */
export function sessionHubFor(hub: MemoryHub): MemoryHub {
  let found = sessionHubs.get(hub);
  if (!found) {
    found = new MemoryHub();
    sessionHubs.set(hub, found);
  }
  return found;
}

/** The one session ("General") of a room without a server, as this person has it open. */
export function general(room: RoomSession): SessionConn {
  const conn = room.conn(LOCAL_SESSION_ID);
  if (!conn) throw new Error('the session is not open yet');
  return conn;
}

/** Waits until the room's session is open and its prompt exists. */
export async function sessionOpen(room: RoomSession): Promise<SessionConn> {
  const t = Date.now();
  for (;;) {
    const conn = room.conn(LOCAL_SESSION_ID);
    if (conn?.getSnapshot().promptReady) return conn;
    if (Date.now() - t > 4000) throw new Error('the session did not open');
    await new Promise((r) => setTimeout(r, 5));
  }
}
