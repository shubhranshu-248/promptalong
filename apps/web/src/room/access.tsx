import { formatRoomCode } from '@promptalong/core';
import { Button, buttonClass } from '@promptalong/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { AccessFailure } from '../backend';

function Blocked({
  testId,
  badge,
  title,
  children,
  actions,
}: {
  testId: string;
  badge: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-14">
      <div className="max-w-[440px] text-center" data-testid={testId}>
        <p
          aria-hidden="true"
          className="mx-auto mb-[18px] grid size-14 place-items-center rounded-full bg-surface-2 font-display text-[22px] font-bold"
        >
          {badge}
        </p>
        <h1 className="text-[26px] font-bold">{title}</h1>
        <p className="mt-2.5 text-text-muted">{children}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">{actions}</div>
      </div>
    </main>
  );
}

const start = (primary: boolean) => (
  <Link to="/new" className={buttonClass(primary ? { variant: 'primary' } : {})}>
    Start a room
  </Link>
);

/** Mockup 09 D and its siblings: every way a room can refuse someone. */
export function RoomBlocked({
  reason,
  code,
  name,
  onRetry,
}: {
  reason: AccessFailure | 'deleted';
  code: string;
  name?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  const room = name ? `"${name}"` : 'this room';
  const again = onRetry ? <Button onClick={onRetry}>Try again</Button> : null;
  switch (reason) {
    case 'locked':
      return (
        <Blocked
          testId="room-locked"
          badge="🔒"
          title="This room is locked"
          actions={
            <>
              {onRetry ? (
                <Button variant="primary" onClick={onRetry}>
                  Try again
                </Button>
              ) : null}
              {start(false)}
            </>
          }
        >
          The host has locked {room}. Ask them to unlock it, then try again.
        </Blocked>
      );
    case 'full':
      return (
        <Blocked
          testId="room-full"
          badge="8"
          title="This room is full"
          actions={
            <>
              {start(true)}
              {again}
            </>
          }
        >
          {name ? `"${name}"` : 'This room'} already has 8 people, the most a room can hold. Ask
          someone to leave, or start your own room.
        </Blocked>
      );
    case 'removed':
      return (
        <Blocked
          testId="room-removed"
          badge="–"
          title="You were removed from this room"
          actions={start(true)}
        >
          The host removed you from {room}. You cannot join it again from this browser.
        </Blocked>
      );
    case 'deleted':
      return (
        <Blocked
          testId="room-deleted"
          badge="×"
          title="This room was deleted"
          actions={start(true)}
        >
          The host deleted {room}. Nothing of it is kept on the server.
        </Blocked>
      );
    case 'rate-limited':
      return (
        <Blocked
          testId="room-rate-limited"
          badge="…"
          title="Too many tries for now"
          actions={
            <>
              {again}
              <Link to="/" className={buttonClass({})}>
                Back to the start
              </Link>
            </>
          }
        >
          This browser started or tried to join a lot of rooms in the last hour. Wait a few minutes
          and try again.
        </Blocked>
      );
    case 'offline':
      return (
        <Blocked testId="room-offline" badge="⌁" title="You are offline" actions={again}>
          Room {formatRoomCode(code)} is not saved on this device yet. Connect to the internet and
          try again.
        </Blocked>
      );
    case 'unavailable':
    case 'code-taken':
      return (
        <Blocked
          testId="room-unavailable"
          badge="!"
          title="Rooms cannot be opened right now"
          actions={
            <>
              {again}
              {start(false)}
            </>
          }
        >
          The room service did not answer as expected. Try again in a minute.
        </Blocked>
      );
    case 'not-found':
      return (
        <Blocked
          testId="room-not-found"
          badge="?"
          title={`No room with code ${formatRoomCode(code)}`}
          actions={
            <>
              <Link to="/new#join" className={buttonClass({ variant: 'primary' })}>
                Enter another code
              </Link>
              {start(false)}
            </>
          }
        >
          Check the code with your teammate - codes are 6 letters and numbers. Rooms idle for 30
          days are deleted.
        </Blocked>
      );
  }
}
