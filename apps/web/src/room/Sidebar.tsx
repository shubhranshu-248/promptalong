import * as Menu from '@radix-ui/react-dropdown-menu';
import { formatRoomCode } from '@promptalong/core';
import { LogoMark, cx, initials } from '@promptalong/ui';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  CheckIcon,
  CloseIcon,
  LinkIcon,
  LockIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
} from './icons';
import type { PersonView } from './session';

const ACTIVITY: Record<PersonView['activity'], string> = {
  typing: 'typing…',
  selecting: 'selecting',
  idle: 'here',
  sending: 'sending…',
};

export function Avatar({ person, size = 28 }: { person: PersonView; size?: number }) {
  return (
    <span
      className="relative inline-grid flex-none place-items-center rounded-full font-semibold leading-none"
      style={{
        width: size,
        height: size,
        fontSize: size >= 28 ? 11 : 9,
        background: person.color,
        color: person.label,
      }}
      aria-hidden="true"
    >
      {initials(person.name)}
    </span>
  );
}

const menuItem =
  'flex cursor-default items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium outline-none data-[highlighted]:bg-surface-2';

function PeopleList({
  people,
  manage,
  sessionName,
}: {
  people: PersonView[];
  /** the name of the session someone has open (only shown when the room has several) */
  sessionName?: ((id: string) => string | null) | undefined;
  /** host powers (only given to the host of a room that has a server) */
  manage?: { makeHost: (p: PersonView) => void; remove: (p: PersonView) => void } | undefined;
}) {
  return (
    <section aria-labelledby="people-h">
      <h2 id="people-h" className="px-2 font-body text-xs font-medium text-text-muted">
        People here, {people.length} of 16
      </h2>
      <ul className="mt-1.5 flex flex-col gap-0.5" data-testid="people-list">
        {people.map((p) => (
          <li
            key={p.pid}
            className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2"
            data-pid={p.pid}
          >
            <span className="relative">
              <Avatar person={p} />
              {p.activity === 'typing' || p.activity === 'sending' ? (
                <span
                  className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-surface bg-success"
                  aria-hidden="true"
                />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-tight">
                <span className="font-medium">{p.name}</span>
                {p.me ? <span className="text-text-muted"> (you)</span> : null}
                {p.host ? (
                  <span className="ml-1.5 text-[11px] font-semibold text-accent">host</span>
                ) : null}
              </p>
              <p className="truncate text-xs text-text-muted">
                {ACTIVITY[p.activity]}
                {p.viewing && sessionName?.(p.viewing)
                  ? ` · in ${sessionName(p.viewing) ?? ''}`
                  : ''}
              </p>
            </div>
            {manage && !p.me ? (
              <Menu.Root>
                <Menu.Trigger asChild>
                  <button
                    type="button"
                    aria-label={`Host actions for ${p.name}`}
                    className="grid size-8 flex-none place-items-center rounded-md text-text-muted hover:bg-surface hover:text-text"
                  >
                    <MoreIcon />
                  </button>
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content
                    align="end"
                    sideOffset={4}
                    className="z-[60] w-[220px] rounded-xl border border-border bg-surface p-1.5 text-text shadow-lg"
                  >
                    <Menu.Item
                      className={menuItem}
                      onSelect={() => {
                        manage.makeHost(p);
                      }}
                    >
                      Make host
                    </Menu.Item>
                    <Menu.Item
                      className={cx(menuItem, 'text-danger')}
                      onSelect={() => {
                        manage.remove(p);
                      }}
                    >
                      Remove from the room…
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    (text: string) => {
      void navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1800);
        },
        () => undefined,
      );
    },
  ];
}

export function Sidebar({
  open,
  onClose,
  demo,
  code,
  people,
  hostOnly,
  hostName,
  managed,
  locked,
  canManage,
  onToggleLock,
  manage,
  myName,
  onRename,
  sessions,
  sessionName,
  onSearch,
}: {
  open: boolean;
  onClose: () => void;
  demo: boolean;
  code: string;
  people: PersonView[];
  hostOnly: boolean;
  hostName: string | null;
  managed: boolean;
  locked: boolean;
  canManage: boolean;
  onToggleLock: () => void;
  manage?: { makeHost: (p: PersonView) => void; remove: (p: PersonView) => void } | undefined;
  myName: string;
  onRename: () => void;
  /** the session list (rooms with several sessions, or a host who can add one) */
  sessions?: ReactNode;
  sessionName?: (id: string) => string | null;
  onSearch?: () => void;
}) {
  const [copied, copy] = useCopied();
  const link = `${window.location.origin}/r/${code}`;
  const self = people.find((p) => p.me);
  return (
    <aside
      aria-label="Room"
      className={cx(
        'z-[45] flex w-[272px] flex-none flex-col border-r border-border bg-surface',
        'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-lg max-lg:transition-transform max-lg:duration-200',
        open ? 'max-lg:translate-x-0' : 'max-lg:invisible max-lg:-translate-x-full lg:hidden',
      )}
      data-testid="sidebar"
    >
      <div className="flex h-14 flex-none items-center gap-2 px-3">
        <Link
          to="/"
          aria-label="PromptAlong home"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 font-display text-[16px] font-bold tracking-[-0.02em] text-text no-underline"
        >
          <LogoMark size={24} dot="var(--c-text)" />
          PromptAlong
        </Link>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the sidebar"
          className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <span className="lg:hidden">
            <CloseIcon />
          </span>
          <span className="max-lg:hidden">
            <SidebarIcon />
          </span>
        </button>
      </div>

      <div className="px-3">
        <Link
          to="/new"
          className="flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-text no-underline hover:bg-surface-2"
        >
          <PlusIcon />
          New room
        </Link>
        {onSearch ? (
          <button
            type="button"
            onClick={onSearch}
            className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium text-text hover:bg-surface-2"
            data-testid="open-search"
          >
            <SearchIcon />
            <span className="flex-1">Search</span>
            <kbd className="rounded border border-border px-1.5 font-mono text-[11px] text-text-muted max-lg:hidden">
              {/Mac|iPhone|iPad/u.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pt-4 pb-3">
        {demo ? (
          <p className="rounded-xl bg-surface-2 px-3 py-3 text-xs leading-relaxed text-text-muted">
            This demo room lives only in your browser. Start your own room to invite your team.
          </p>
        ) : (
          <section
            aria-label="Invite"
            className="rounded-xl border border-border px-3 pt-3 pb-2.5"
            data-testid="invite-card"
          >
            <p className="text-xs text-text-muted">Room code</p>
            <p className="mt-0.5 font-mono text-[19px] font-semibold tracking-[.1em]">
              {formatRoomCode(code)}
            </p>
            <button
              type="button"
              onClick={() => {
                copy(link);
              }}
              className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary-btn-bg text-sm font-semibold text-primary-btn-text hover:opacity-90"
              data-testid="copy-invite"
            >
              {copied ? <CheckIcon /> : <LinkIcon />}
              {copied ? 'Link copied' : 'Copy invite link'}
            </button>
            <p className="mt-2.5 text-xs text-text-muted">
              {hostOnly
                ? `Only ${hostName ?? 'the host'} can press Send.`
                : 'Everyone can press Send.'}
            </p>
            {managed ? (
              <div className="mt-1.5 flex items-center gap-2 text-xs" data-testid="room-lock">
                <span className="flex items-center gap-1 text-text-muted">
                  <LockIcon />
                  {locked ? 'Locked: no one new can join' : 'Open to anyone with the code'}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    onClick={onToggleLock}
                    aria-pressed={locked}
                    className="ml-auto rounded-md px-1.5 py-0.5 font-semibold text-accent hover:bg-accent-soft"
                    data-testid="lock-button"
                  >
                    {locked ? 'Unlock' : 'Lock'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        )}
        {sessions}
        <PeopleList people={people} manage={manage} sessionName={sessionName} />
      </div>

      <div className="flex-none border-t border-border px-3 py-2.5">
        <button
          type="button"
          onClick={onRename}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
          title="Change your name"
        >
          {self ? <Avatar person={self} /> : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{myName}</span>
            <span className="block text-xs text-text-muted">Change your name</span>
          </span>
        </button>
      </div>
    </aside>
  );
}
