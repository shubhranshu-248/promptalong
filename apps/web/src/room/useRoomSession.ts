import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import { createTransport, realtimeConfig } from '../realtime';
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
export function useRoomSession(
  code: string,
  pid: string,
  name: string,
  create: CreateOptions | undefined,
): RoomSession | null {
  const [session, setSession] = useState<RoomSession | null>(null);
  const initial = useRef({ name, create });
  useEffect(() => {
    const s = new RoomSession({
      code,
      pid,
      name: initial.current.name,
      transport: createTransport(realtimeConfig, code),
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
  }, [code, pid]);
  return session;
}

export function useRoomSnapshot(session: RoomSession): RoomSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
