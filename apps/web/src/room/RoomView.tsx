import * as Menu from '@radix-ui/react-dropdown-menu';
import { cleanDisplayName, formatRoomCode } from '@promptalong/core';
import { Button, LogoMark, buttonClass, cx, initials } from '@promptalong/ui';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { realtimeConfig } from '../realtime';
import { getThemePreference, setThemePreference, type ThemePreference } from '../theme';
import { saveDisplayName } from './identity';
import { PromptEditor } from './PromptEditor';
import { RenameDialog, ShareDialog } from './dialogs';
import type { PersonView, RoomSession, RoomSnapshot } from './session';
import { useRoomSnapshot } from './useRoomSession';

const ACTIVITY: Record<PersonView['activity'], string> = {
  typing: 'typing…',
  selecting: 'selecting',
  idle: 'here',
};

function Avatar({ person, size = 32 }: { person: PersonView; size?: number }) {
  return (
    <span
      className="inline-grid flex-none place-items-center rounded-full border-2 border-surface font-bold leading-none"
      style={{
        width: size,
        height: size,
        fontSize: size >= 32 ? 12 : 9,
        background: person.color,
        color: person.label,
      }}
      aria-hidden="true"
    >
      {initials(person.name)}
    </span>
  );
}

function PeopleList({ people }: { people: PersonView[] }) {
  return (
    <section aria-labelledby="people-h">
      <h2
        id="people-h"
        className="font-body text-xs font-semibold tracking-[.06em] text-text-muted uppercase"
      >
        People · {people.length} of 8
      </h2>
      <ul className="mt-2" data-testid="people-list">
        {people.map((p) => (
          <li key={p.pid} className="flex items-center gap-2.5 rounded-md p-2" data-pid={p.pid}>
            <Avatar person={p} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <b>{p.name}</b>
                {p.me ? <span className="text-xs text-text-muted"> (you)</span> : null}
                {p.host ? (
                  <span className="ml-1.5 inline-flex h-5 items-center rounded-pill bg-surface-2 px-2 text-[10px] font-semibold">
                    host
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-text-muted">{ACTIVITY[p.activity]}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoomMenu({
  onShare,
  onRename,
  onLeave,
}: {
  onShare: () => void;
  onRename: () => void;
  onLeave: () => void;
}) {
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const item =
    'flex cursor-default items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium outline-none data-[highlighted]:bg-surface-2';
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="sm" aria-label="Room menu" className="w-10 px-0">
          ⋯
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-[40] w-[260px] rounded-lg border border-border bg-surface p-1.5 text-text shadow-lg"
        >
          <Menu.Item className={item} onSelect={onShare}>
            Share link and code
          </Menu.Item>
          <Menu.Item className={item} onSelect={onRename}>
            Change your name
          </Menu.Item>
          <Menu.Separator className="mx-1 my-1.5 h-px bg-border" />
          <Menu.Label className="px-3 pt-1 pb-1 text-xs font-semibold text-text-muted">
            Theme
          </Menu.Label>
          <Menu.RadioGroup
            value={theme}
            onValueChange={(v) => {
              const pref: ThemePreference = v === 'light' || v === 'dark' ? v : 'system';
              setTheme(pref);
              setThemePreference(pref);
            }}
          >
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Menu.RadioItem key={t} value={t} className={item}>
                <span className="w-3" aria-hidden="true">
                  <Menu.ItemIndicator>●</Menu.ItemIndicator>
                </span>
                {t === 'system' ? 'Same as device' : t === 'light' ? 'Light' : 'Dark'}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Menu.Separator className="mx-1 my-1.5 h-px bg-border" />
          <Menu.Item className={cx(item, 'text-danger')} onSelect={onLeave}>
            Leave room
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function statusLine(s: RoomSnapshot): string {
  const editing = s.people.filter((p) => p.activity === 'typing').length;
  const who =
    s.people.length > 1
      ? `${s.people.length} people here${editing > 0 ? ` · ${editing} typing` : ''}`
      : 'just you';
  if (s.state === 'offline') return `${who} · saved on this device · waiting to sync`;
  if (s.state === 'connecting') return `${who} · connecting…`;
  if (!s.savedLocally) return `${who} · loading`;
  return `${who} · saved`;
}

function Notice({
  tone,
  children,
  testId,
}: {
  tone: 'warn' | 'info';
  children: ReactNode;
  testId: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cx(
        'flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium',
        tone === 'warn' ? 'bg-warning-bg text-warning-text' : 'bg-accent-soft text-text',
      )}
    >
      {children}
    </div>
  );
}

export function RoomFull({ name }: { name: string | null }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-14">
      <div className="max-w-[440px] text-center" data-testid="room-full">
        <p
          aria-hidden="true"
          className="mx-auto mb-[18px] grid size-14 place-items-center rounded-full bg-surface-2 font-display text-[22px] font-bold"
        >
          8
        </p>
        <h1 className="text-[26px] font-bold">This room is full</h1>
        <p className="mt-2.5 text-text-muted">
          {name ? `"${name}"` : 'This room'} already has 8 people, the most a room can hold. Ask
          someone to leave, or start your own room.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link to="/new" className={buttonClass({ variant: 'primary' })}>
            Start a room
          </Link>
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}

export function RoomView({ session, openShare }: { session: RoomSession; openShare: boolean }) {
  const snap = useRoomSnapshot(session);
  const navigate = useNavigate();
  const [shareOpen, setShareOpen] = useState(openShare);
  const [renameOpen, setRenameOpen] = useState(false);
  const [tab, setTab] = useState<'chat' | 'people'>('chat');

  if (snap.full) return <RoomFull name={snap.settings?.name ?? null} />;

  const title = snap.settings?.name ?? formatRoomCode(session.code);
  const others = snap.people.length - 1;
  const localOnly = realtimeConfig.mode === 'none';

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 flex-none items-center gap-3 border-b border-border bg-surface px-4 max-md:gap-2 max-md:px-3">
        <Link to="/" aria-label="PromptAlong home" className="flex-none">
          <LogoMark size={28} dot="var(--c-text)" />
        </Link>
        <div className="min-w-0">
          <h1
            className="truncate font-display text-[17px] leading-tight font-semibold"
            data-testid="room-title"
          >
            {title}
          </h1>
          <p className="text-xs text-text-muted md:hidden">
            {session.code} · {snap.people.length} {snap.people.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        <span className="rounded-sm bg-surface-2 px-2 py-[5px] font-mono text-xs leading-none max-md:hidden">
          {session.code}
        </span>
        <Button
          size="sm"
          className="max-md:hidden"
          onClick={() => {
            setShareOpen(true);
          }}
        >
          Share link
        </Button>
        <span className="flex-1" />
        <span
          className="flex max-md:hidden [&>*+*]:-ml-1.5"
          aria-label={`${snap.people.length} people in the room`}
          role="img"
        >
          {snap.people.map((p) => (
            <Avatar key={p.pid} person={p} />
          ))}
        </span>
        <span className="h-6 w-px bg-border max-md:hidden" aria-hidden="true" />
        <span
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 text-xs font-semibold"
          title="The model is chosen in a later update; rooms use the demo model."
        >
          <span className="size-2 rounded-full bg-success" aria-hidden="true" />
          <span className="max-md:hidden">Model:</span> Demo
        </span>
        <RoomMenu
          onShare={() => {
            setShareOpen(true);
          }}
          onRename={() => {
            setRenameOpen(true);
          }}
          onLeave={() => {
            session.stop();
            void navigate('/');
          }}
        />
      </header>

      {snap.state === 'offline' ? (
        <Notice tone="warn" testId="offline-banner">
          <span>
            <b>Offline</b> - your edits are saved on this device and will sync when you are back
            online.
          </span>
        </Notice>
      ) : localOnly ? (
        <Notice tone="info" testId="local-only-banner">
          <span>
            <b>Only on this device.</b> Live sync is not switched on for this site yet, so others
            cannot join.
          </span>
        </Notice>
      ) : snap.state === 'alone' && others === 0 ? (
        <Notice tone="info" testId="alone-banner">
          <span>
            <b>No one else is here yet.</b> Share the link or code - everything you write syncs as
            soon as someone joins.
          </span>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              setShareOpen(true);
            }}
          >
            Share
          </Button>
        </Notice>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] max-md:grid-cols-1">
        <aside
          aria-label="Room"
          className={cx(
            'flex flex-col gap-[18px] overflow-auto border-r border-border bg-surface p-4',
            tab === 'people' ? 'max-md:flex' : 'max-md:hidden',
          )}
        >
          <PeopleList people={snap.people} />
          <section className="mt-auto" aria-labelledby="room-h">
            <h2
              id="room-h"
              className="font-body text-xs font-semibold tracking-[.06em] text-text-muted uppercase"
            >
              Room
            </h2>
            <p className="mt-2 flex justify-between text-sm">
              <span>Who can Send</span>
              <b>{snap.settings?.sendPolicy === 'host' ? 'Host only' : 'Everyone'}</b>
            </p>
          </section>
        </aside>

        <main
          className={cx('flex min-w-0 flex-col', tab === 'chat' ? '' : 'max-md:hidden')}
          aria-label="Shared prompt and answers"
        >
          <div className="flex flex-1 items-center justify-center overflow-auto p-8 max-md:p-4">
            <p className="max-w-[420px] text-center text-sm text-text-muted">
              Answers will stream in here for everyone. For now, write the prompt together below -
              every keystroke shows up on every screen.
            </p>
          </div>
          <div className="border-t border-border bg-surface px-6 pt-3.5 pb-4 max-md:p-3">
            <p
              className="mb-2 text-xs text-text-muted"
              aria-live="polite"
              data-testid="sync-status"
            >
              <b className="text-text">Shared prompt</b> · {statusLine(snap)}
            </p>
            {snap.savedLocally && snap.state !== 'connecting' ? (
              <PromptEditor session={session} />
            ) : (
              // Starting the editor before the first sync would add a second empty paragraph.
              <div className="pa-editor text-text-muted" role="status" data-testid="prompt-loading">
                Loading the shared prompt…
              </div>
            )}
          </div>
        </main>
      </div>

      <nav
        aria-label="Room sections"
        className="flex h-[60px] flex-none border-t border-border bg-surface md:hidden"
      >
        {(['chat', 'people'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t);
            }}
            className={cx(
              'flex flex-1 flex-col items-center justify-center gap-[3px] text-[11px] font-semibold',
              tab === t ? 'text-text' : 'text-text-muted',
            )}
          >
            <i
              aria-hidden="true"
              className={cx('h-[3px] w-5 rounded-sm bg-current', tab === t ? '' : 'opacity-50')}
            />
            {t === 'chat' ? 'Chat' : `People (${snap.people.length})`}
          </button>
        ))}
      </nav>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        code={session.code}
        here={snap.people.length}
      />
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        current={snap.me.name}
        onSave={(name) => {
          const clean = cleanDisplayName(name);
          if (!clean) return false;
          saveDisplayName(clean);
          session.rename(clean);
          return true;
        }}
      />
    </div>
  );
}
