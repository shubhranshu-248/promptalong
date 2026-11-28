import { cleanDisplayName, formatRoomCode, normalizeRoomCode } from '@promptalong/core';
import { Button, Chip, buttonClass, initials, presenceHex } from '@promptalong/ui';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { backend } from '../backend';
import { SiteNav } from '../components/SiteNav';
import { RoomBlocked } from './access';
import { NameField } from './dialogs';
import { getDisplayName, saveDisplayName } from './identity';
import { RoomView } from './RoomView';
import type { CreateOptions } from './session';
import { useRoomAccess } from './useRoomAccess';
import { useRoomSession, type OpenRoom } from './useRoomSession';

interface RoomLocationState {
  create?: CreateOptions;
  share?: boolean;
}

function readState(value: unknown): RoomLocationState {
  if (typeof value !== 'object' || value === null) return {};
  const v = value as Record<string, unknown>;
  const out: RoomLocationState = {};
  const c = v.create as Record<string, unknown> | undefined;
  if (c && typeof c.name === 'string' && (c.sendPolicy === 'everyone' || c.sendPolicy === 'host')) {
    out.create = { name: c.name, sendPolicy: c.sendPolicy };
  }
  if (v.share === true) out.share = true;
  return out;
}

export function JoinGate({ code, onJoin }: { code: string; onJoin: (name: string) => void }) {
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);
  const preview = presenceHex(1);
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[440px] px-4 py-10 md:px-6">
        <Chip tone="accent">Room {formatRoomCode(code)}</Chip>
        <h1 className="mt-3.5 text-[28px] font-bold">Join the room</h1>
        <p className="mt-2 text-text-muted">
          Pick the name your team will see next to your cursor and on what you write.
        </p>
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            const clean = cleanDisplayName(name);
            setInvalid(!clean);
            if (clean) onJoin(clean);
          }}
        >
          <div className="flex items-center gap-3 rounded-md bg-surface-2 p-3">
            <span
              aria-hidden="true"
              className="grid size-10 flex-none place-items-center rounded-full text-sm font-bold"
              style={{ background: preview.color, color: preview.label }}
            >
              {name.trim() ? initials(name) : '?'}
            </span>
            <div className="flex-1">
              <label htmlFor="gate-name" className="mb-1 block text-sm font-semibold">
                Your display name
              </label>
              <NameField id="gate-name" value={name} onChange={setName} invalid={invalid} />
            </div>
          </div>
          {invalid ? <p className="mt-1.5 text-xs text-danger">Type at least one letter.</p> : null}
          <Button type="submit" variant="primary" size="lg" className="mt-[18px] w-full">
            Join room
          </Button>
          <p className="mt-2.5 text-xs text-text-muted">
            Anyone with the code can join until the host locks the room. Don&apos;t paste secrets
            into a shared prompt.
          </p>
        </form>
      </main>
    </>
  );
}

function Opening({ code }: { code: string }) {
  return (
    <p className="p-8 text-center text-sm text-text-muted" role="status">
      Opening room {formatRoomCode(code)}…
    </p>
  );
}

function OpenRoomView({
  code,
  name,
  open,
  state,
}: {
  code: string;
  name: string;
  open: OpenRoom;
  state: RoomLocationState;
}) {
  const session = useRoomSession(code, open, name, state.create);
  if (!session) return <Opening code={code} />;
  return <RoomView session={session} openShare={state.share === true} />;
}

/** Gets a seat from the server first; the room opens only when the server says yes. */
function RoomLoader({
  code,
  name,
  state,
}: {
  code: string;
  name: string;
  state: RoomLocationState;
}) {
  const service = backend();
  const access = useRoomAccess(service, code, name, state.create);
  if (access.state.status === 'checking') return <Opening code={code} />;
  if (access.state.status === 'blocked') {
    return (
      <RoomBlocked
        reason={access.state.reason}
        code={code}
        name={access.state.name}
        onRetry={access.retry}
      />
    );
  }
  const { room, uid, slot } = access.state;
  return (
    <OpenRoomView
      code={code}
      name={name}
      open={{ backend: service, room, uid, slot }}
      state={state}
    />
  );
}

/** A new room code mounts a fresh page with its own creation details. */
export function RoomPage() {
  const { code: raw = '' } = useParams();
  return <RoomPageFor key={raw} raw={raw} />;
}

function RoomPageFor({ raw }: { raw: string }) {
  const location = useLocation();
  const code = normalizeRoomCode(raw);
  const [name, setName] = useState<string | null>(() => getDisplayName());
  const [state] = useState(() => readState(location.state));

  // Creation details are used once; a reload must not try to create the room again.
  useEffect(() => {
    if (location.state) window.history.replaceState({ ...window.history.state, usr: null }, '');
  }, [location.state]);

  if (!code) {
    return (
      <>
        <SiteNav />
        <main className="mx-auto max-w-[720px] px-4 py-16 md:px-6">
          <h1 className="text-[32px] font-bold md:text-[44px]">That code does not look right</h1>
          <p className="mt-4 text-[17px] text-text-muted">
            Room codes are 6 letters and numbers, like K7Q-M2X.
          </p>
          <Link to="/new#join" className={`${buttonClass({ variant: 'primary' })} mt-8`}>
            Enter another code
          </Link>
        </main>
      </>
    );
  }
  if (code !== raw) return <Navigate to={`/r/${code}`} replace state={location.state as unknown} />;
  if (!name) {
    return (
      <JoinGate
        code={code}
        onJoin={(n) => {
          setName(saveDisplayName(n));
        }}
      />
    );
  }
  return <RoomLoader code={code} name={name} state={state} />;
}
