import { useEffect, useRef, useState } from 'react';
import type { AccessFailure, RoomBackend, RoomInfo } from '../backend';
import { safeStorage } from './storage';

export type RoomAccessState =
  | { status: 'checking' }
  | { status: 'open'; room: RoomInfo; uid: string; slot: number }
  | { status: 'blocked'; reason: AccessFailure; name?: string };

const seatKey = (code: string) => `promptalong:seat:${code}`;

/** The seat this browser last had in a room: lets the local copy open while offline. */
function rememberSeat(code: string, seat: { room: RoomInfo; uid: string; slot: number }): void {
  safeStorage.set(seatKey(code), JSON.stringify(seat));
}

function recallSeat(code: string): { room: RoomInfo; uid: string; slot: number } | null {
  try {
    const v = JSON.parse(safeStorage.get(seatKey(code)) ?? 'null') as {
      room?: Partial<RoomInfo>;
      uid?: unknown;
      slot?: unknown;
    } | null;
    if (!v?.room || typeof v.room.id !== 'string' || typeof v.uid !== 'string') return null;
    return {
      room: {
        id: v.room.id,
        code,
        name: typeof v.room.name === 'string' ? v.room.name : '',
        hostUid: typeof v.room.hostUid === 'string' ? v.room.hostUid : '',
        locked: v.room.locked === true,
      },
      uid: v.uid,
      slot: typeof v.slot === 'number' ? v.slot : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Asks the server for a seat in the room (creating the room first when this visit started from
 * "Create room"). The server decides: not found, locked, full, removed, too many attempts.
 */
export function useRoomAccess(
  backend: RoomBackend,
  code: string,
  displayName: string,
  create: { name: string } | undefined,
): { state: RoomAccessState; retry: () => void } {
  const [state, setState] = useState<RoomAccessState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const first = useRef({ displayName, create });
  useEffect(() => {
    const run = { live: true };
    // (a function, so the check is made again after every await)
    const cancelled = () => !run.live;
    const { displayName: name, create: creating } = first.current;
    void (async () => {
      const uid = await backend.uid();
      if (cancelled()) return;
      if (uid === null) {
        const seat = navigator.onLine ? null : recallSeat(code);
        setState(
          seat
            ? { status: 'open', ...seat }
            : { status: 'blocked', reason: navigator.onLine ? 'unavailable' : 'offline' },
        );
        return;
      }
      const res = creating
        ? await backend.createRoom({ code, name: creating.name, displayName: name })
        : await backend.joinRoom(code, name);
      if (cancelled()) return;
      if (res.ok) {
        const seat = { room: res.room, uid: res.uid, slot: res.slot };
        if (backend.server) rememberSeat(code, seat);
        setState({ status: 'open', ...seat });
        return;
      }
      // no connection: open the copy saved on this device if this browser had a seat before
      const seat = res.reason === 'offline' ? recallSeat(code) : null;
      if (seat?.uid === uid) setState({ status: 'open', ...seat });
      else
        setState(
          res.name
            ? { status: 'blocked', reason: res.reason, name: res.name }
            : { status: 'blocked', reason: res.reason },
        );
    })();
    return () => {
      run.live = false;
    };
  }, [backend, code, attempt]);
  return {
    state,
    retry: () => {
      // a retry never creates: the room either exists by now or it does not
      first.current = { ...first.current, create: undefined };
      setState({ status: 'checking' });
      setAttempt((n) => n + 1);
    },
  };
}
