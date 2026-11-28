import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { RoomBackend, RoomInfo } from '../backend';
import { realtimeConfig } from '../realtime';
import { RoomSession, type CreateOptions, type RoomSnapshot } from './session';
import type { SessionConn, SessionSnapshot } from './session-conn';

declare global {
  interface Window {
    /** test/debug hook, only set when the local relay is in use */
    __promptalong?: { session: RoomSession };
  }
}

/**
 * Opens a room for as long as the component is mounted. The session is created inside the effect
 * so React's development double-mount gets two clean sessions instead of a stopped one.
 */
export interface OpenRoom {
  backend: RoomBackend;
  room: RoomInfo;
  /** this person's id on that backend */
  uid: string;
  slot: number;
}

export function useRoomSession(
  code: string,
  open: OpenRoom,
  name: string,
  create: CreateOptions | undefined,
): RoomSession | null {
  const [session, setSession] = useState<RoomSession | null>(null);
  const initial = useRef({ name, create, open });
  useEffect(() => {
    const { backend, room, uid, slot } = initial.current.open;
    const s = new RoomSession({
      code,
      pid: uid,
      name: initial.current.name,
      transport: backend.transport(room),
      access: { backend, room, slot },
      persist: (doc, key) => new IndexeddbPersistence(key, doc),
      remember: sessionStorageOrNone(),
      ...(initial.current.create ? { create: initial.current.create } : {}),
    });
    s.start();
    setSession(s);
    if (realtimeConfig.mode === 'relay') window.__promptalong = { session: s };
    const leave = () => {
      s.stop();
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      s.stop();
    };
  }, [code]);
  return session;
}

function sessionStorageOrNone(): {
  get(k: string): string | null;
  set(k: string, v: string): void;
} {
  return {
    get: (k) => {
      try {
        return sessionStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        sessionStorage.setItem(k, v);
      } catch {
        // storage can be off (private windows): the first session opens instead
      }
    },
  };
}

export function useRoomSnapshot(session: RoomSession): RoomSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/** One session's state (every change in any session tells the room's listeners). */
export function useSessionSnapshot(room: RoomSession, conn: SessionConn): SessionSnapshot {
  return useSyncExternalStore(room.subscribe, conn.getSnapshot);
}
