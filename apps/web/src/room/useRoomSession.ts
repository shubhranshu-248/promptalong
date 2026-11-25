import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { RoomBackend, RoomInfo } from '../backend';
import { realtimeConfig } from '../realtime';
import { RoomSession, type CreateOptions, type RoomSnapshot } from './session';

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
      persist: (doc) => new IndexeddbPersistence(`promptalong:room:${code}`, doc),
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

export function useRoomSnapshot(session: RoomSession): RoomSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
