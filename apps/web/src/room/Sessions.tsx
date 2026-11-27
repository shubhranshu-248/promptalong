import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Button, cx, initials, presenceHex } from '@promptalong/ui';
import { useId, useState } from 'react';
import { DialogShell } from './dialogs';
import { MoreIcon, PlusIcon } from './icons';
import type { SessionView } from './session';

/** Someone the host can put in a session: everyone with a seat in the room. */
export interface Candidate {
  pid: string;
  name: string;
  slot: number;
  /** in the room right now */
  here: boolean;
  me: boolean;
}

export const SESSION_NAME_MAX = 40;

const menuItem =
  'flex cursor-default items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium outline-none data-[highlighted]:bg-surface-2';

function Dot({ slot, name }: { slot: number; name: string }) {
  const c = presenceHex(slot);
  return (
    <span
      className="inline-grid size-[18px] flex-none place-items-center rounded-full text-[8px] font-bold ring-2 ring-surface"
      style={{ background: c.color, color: c.label }}
      title={name}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/**
 * The room's sessions in the sidebar: the open one is marked; the others show what is new in them
 * and who is in them now. The host makes, renames, fills and deletes sessions here.
 */
export function SessionList({
  sessions,
  activeId,
  roster,
  me,
  isHost,
  canManage,
  onOpen,
  onNew,
  onEdit,
  onDelete,
}: {
  sessions: SessionView[];
  activeId: string | null;
  roster: Record<string, { name: string; slot: number }>;
  me: string;
  /** the host sees every session, also those they are not in */
  isHost: boolean;
  /** the room has a server and this person is its host */
  canManage: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onEdit: (s: SessionView) => void;
  onDelete: (s: SessionView) => void;
}) {
  return (
    <section aria-labelledby="sessions-h" data-testid="session-list">
      <div className="flex items-center px-2">
        <h2 id="sessions-h" className="flex-1 font-body text-xs font-medium text-text-muted">
          Sessions
        </h2>
        {canManage ? (
          <button
            type="button"
            onClick={onNew}
            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-accent hover:bg-accent-soft"
            data-testid="new-session"
          >
            <PlusIcon />
            New session
          </button>
        ) : null}
      </div>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {sessions.map((s) => {
          const active = s.id === activeId;
          const inIt = s.members.includes(me);
          const viewers = s.viewers.filter((pid) => pid !== me);
          return (
            <li
              key={s.id}
              className={cx(
                'group flex items-center rounded-lg',
                active ? 'bg-surface-2' : 'hover:bg-surface-2',
              )}
              data-testid="session-item"
              data-session={s.id}
            >
              <button
                type="button"
                onClick={() => {
                  onOpen(s.id);
                }}
                aria-current={active ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
              >
                <span
                  className={cx(
                    'min-w-0 flex-1 truncate text-sm',
                    active || s.unread > 0 ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {s.name}
                  {isHost && !inIt ? (
                    <span className="font-normal text-text-muted"> · not a member</span>
                  ) : null}
                </span>
                {viewers.length > 0 ? (
                  <span className="flex flex-none -space-x-1.5" aria-hidden="true">
                    {viewers.slice(0, 3).map((pid) => (
                      <Dot
                        key={pid}
                        slot={roster[pid]?.slot ?? 1}
                        name={roster[pid]?.name ?? '?'}
                      />
                    ))}
                  </span>
                ) : null}
                {s.streaming && !active ? (
                  <span className="size-2 flex-none rounded-full bg-accent" aria-hidden="true" />
                ) : null}
                {s.unread > 0 && !active ? (
                  <span
                    className="min-w-5 flex-none rounded-pill bg-text px-1.5 text-center text-[11px] leading-5 font-semibold text-bg"
                    data-testid="session-unread"
                  >
                    {s.unread > 99 ? '99+' : s.unread}
                  </span>
                ) : null}
                <span className="sr-only">
                  {[
                    active ? 'open now' : '',
                    s.unread > 0 && !active ? `${String(s.unread)} new` : '',
                    s.streaming ? 'an answer is coming in' : '',
                    viewers.length > 0 ? `${String(viewers.length)} here` : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </button>
              {canManage ? (
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <button
                      type="button"
                      aria-label={`Session actions for ${s.name}`}
                      className="mr-1 grid size-8 flex-none place-items-center rounded-md text-text-muted opacity-0 group-hover:opacity-100 hover:bg-surface hover:text-text focus-visible:opacity-100 data-[state=open]:opacity-100 max-lg:opacity-100"
                    >
                      <MoreIcon />
                    </button>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content
                      align="end"
                      sideOffset={4}
                      className="z-[60] w-[200px] rounded-xl border border-border bg-surface p-1.5 text-text shadow-lg"
                    >
                      <Menu.Item
                        className={menuItem}
                        onSelect={() => {
                          onEdit(s);
                        }}
                      >
                        Rename or change people…
                      </Menu.Item>
                      {s.isDefault ? null : (
                        <Menu.Item
                          className={cx(menuItem, 'text-danger')}
                          onSelect={() => {
                            onDelete(s);
                          }}
                        >
                          Delete session…
                        </Menu.Item>
                      )}
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Host: name a session and choose who is in it (create or change). */
export function SessionDialog({
  open,
  onOpenChange,
  editing,
  candidates,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the session being changed; null makes a new one */
  editing: SessionView | null;
  candidates: Candidate[];
  /** resolves to an error to show, or null when saved */
  onSave: (name: string, members: string[]) => Promise<string | null>;
}) {
  const ids = { name: useId() };
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [was, setWas] = useState(false);
  if (was !== open) {
    setWas(open);
    if (open) {
      setName(editing?.name ?? '');
      setMembers(editing ? editing.members : candidates.filter((c) => c.me).map((c) => c.pid));
      setProblem(null);
    }
  }
  const toggle = (pid: string, on: boolean) => {
    setMembers((m) => (on ? [...m, pid] : m.filter((x) => x !== pid)));
  };
  const clean = name.trim().replace(/\s+/gu, ' ');
  const known = new Set(candidates.map((c) => c.pid));
  // people still listed who are not shown (they left long ago): kept unless the host changes it
  const hidden = members.filter((pid) => !known.has(pid));
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Change ${editing.name}` : 'New session'}
      description="A session has its own prompt, answers and files. Only the people in it can open it; you can open every session as the host."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!clean) {
            setProblem('Give the session a name.');
            return;
          }
          if (members.length === 0) {
            setProblem('Choose at least one person.');
            return;
          }
          setBusy(true);
          void onSave(clean, members).then((err) => {
            setBusy(false);
            if (err) setProblem(err);
            else onOpenChange(false);
          });
        }}
      >
        <label className="mb-1.5 block text-sm font-semibold" htmlFor={ids.name}>
          Name
        </label>
        <input
          id={ids.name}
          value={name}
          maxLength={SESSION_NAME_MAX}
          placeholder="Slides, Demo script, Research…"
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-base text-text"
          data-testid="session-name"
        />
        <fieldset className="mt-5">
          <legend className="mb-1.5 text-sm font-semibold">
            People in it <span className="font-normal text-text-muted">({members.length})</span>
          </legend>
          <ul className="flex max-h-[38vh] flex-col gap-0.5 overflow-y-auto">
            {candidates.map((c) => (
              <li key={c.pid}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={members.includes(c.pid)}
                    onChange={(e) => {
                      toggle(c.pid, e.target.checked);
                    }}
                    className="size-[18px] flex-none accent-[var(--c-accent)]"
                    data-testid={`member-${c.name}`}
                  />
                  <Dot slot={c.slot} name={c.name} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {c.name}
                    {c.me ? <span className="text-text-muted"> (you)</span> : null}
                  </span>
                  <span className="text-xs text-text-muted">{c.here ? 'here' : 'away'}</span>
                </label>
              </li>
            ))}
          </ul>
          {hidden.length > 0 ? (
            <p className="mt-1.5 text-xs text-text-muted">
              Also in it: {hidden.length} {hidden.length === 1 ? 'person' : 'people'} who left the
              room and may come back.
            </p>
          ) : null}
        </fieldset>
        {problem ? (
          <p className="mt-3 text-sm text-danger" role="alert" data-testid="session-problem">
            {problem}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2.5">
          <Dialog.Close asChild>
            <Button>Cancel</Button>
          </Dialog.Close>
          <Button type="submit" variant="primary" disabled={busy} data-testid="session-save">
            {editing ? 'Save' : 'Create session'}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
