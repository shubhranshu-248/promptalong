import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  MAIN_BRANCH,
  applyMerge,
  cleanDisplayName,
  createBranch,
  createRoomCode,
  forkPayload,
  formatRoomCode,
  planMerge,
  renameBranch,
  setActiveBranch,
  setRoomModel,
  type MergePlan,
  type TurnView,
} from '@promptalong/core';
import {
  DEFAULT_MODEL,
  findEndpoint,
  modelLabel,
  type ProviderKind,
  type RoomModelChoice,
} from '@promptalong/providers';
import { Button, LogoMark, buttonClass, cx, initials } from '@promptalong/ui';
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ContextPanel, ContextWide, type PanelTab } from '../context/ContextPanel';
import { useContextBudget } from '../context/useContextBudget';
import { matchesMedia, useMedia } from '../context/useMedia';
import { useKeyStore } from '../keys/useKeyStore';
import { RoomBlocked } from './access';
import { AddKeyDialog, ModelDialog } from '../models/ModelDialog';
import { isWebLlmReady } from '../models/webllm-state';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { realtimeConfig } from '../realtime';
import { getThemePreference, setThemePreference, type ThemePreference } from '../theme';
import { saveDisplayName } from './identity';
import { PromptEditor } from './PromptEditor';
import { DialogShell, RenameDialog, ShareDialog } from './dialogs';
import { AuthorStyles } from './AuthorText';
import { authorName } from './authors';
import { BranchDialog, ForkDialog, MergeDialog, RenameBranchDialog } from './branch-dialogs';
import { Compare } from './Compare';
import { sendPrompt, type Retry } from './send';
import { Thread } from './Thread';
import { Tree } from './Tree';
import type { PersonView, RoomSession, RoomSnapshot } from './session';
import { useRoomSnapshot } from './useRoomSession';

const ACTIVITY: Record<PersonView['activity'], string> = {
  typing: 'typing…',
  selecting: 'selecting',
  idle: 'here',
  sending: 'sending…',
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

/** Export is rarely opened: its code is loaded when it is. */
const ExportDialog = lazy(() => import('../export/ExportDialog'));

const menuItem =
  'flex cursor-default items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium outline-none data-[highlighted]:bg-surface-2';

function PeopleList({
  people,
  manage,
}: {
  people: PersonView[];
  /** host powers (only given to the host of a room that has a server) */
  manage?: { makeHost: (p: PersonView) => void; remove: (p: PersonView) => void } | undefined;
}) {
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
            {manage && !p.me ? (
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Host actions for ${p.name}`}
                    className="w-10 flex-none px-0"
                  >
                    ⋯
                  </Button>
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content
                    align="end"
                    sideOffset={4}
                    className="z-[40] w-[220px] rounded-lg border border-border bg-surface p-1.5 text-text shadow-lg"
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

function RoomMenu({
  onShare,
  onRename,
  onLeave,
  onExport,
  lock,
  onDelete,
}: {
  /** omitted in the demo room (it cannot be joined) */
  onShare?: (() => void) | undefined;
  onRename: () => void;
  onLeave: () => void;
  onExport: () => void;
  /** host of a room with a server: lock or unlock */
  lock?: { locked: boolean; toggle: () => void } | undefined;
  onDelete?: (() => void) | undefined;
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
          {onShare ? (
            <Menu.Item className={item} onSelect={onShare}>
              Share link and code
            </Menu.Item>
          ) : null}
          <Menu.Item className={item} onSelect={onRename}>
            Change your name
          </Menu.Item>
          {lock ? (
            <Menu.Item className={item} onSelect={lock.toggle} data-testid="menu-lock">
              {lock.locked ? 'Unlock room' : 'Lock room'}
            </Menu.Item>
          ) : null}
          <Menu.Item className={item} onSelect={onExport}>
            Export
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
          {onDelete ? (
            <Menu.Item className={cx(item, 'text-danger')} onSelect={onDelete}>
              Delete room for everyone…
            </Menu.Item>
          ) : null}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function statusLine(s: RoomSnapshot, demo: boolean): string {
  const editing = s.people.filter((p) => p.activity === 'typing').length;
  const who =
    s.people.length > 1
      ? `${s.people.length} people here${editing > 0 ? ` · ${editing} typing` : ''}`
      : 'just you';
  if (s.state === 'offline') return `${who} · saved on this device · waiting to sync`;
  if (s.state === 'connecting') return `${who} · connecting…`;
  if (!s.savedLocally) return `${who} · loading`;
  return demo ? `${who} · demo, not saved` : `${who} · saved`;
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

/** Mockup 10 A: the room's model runs on someone's key or computer. */
function ModelNotice({
  model,
  people,
  needsKey,
  onChange,
}: {
  model: RoomModelChoice;
  people: PersonView[];
  needsKey: boolean;
  onChange: () => void;
}) {
  if (model.kind === 'mock') return null;
  const setter = people.find((p) => p.pid === model.setBy);
  const owner = setter && !setter.me ? setter.name : null;
  let chip: string;
  let text: string;
  if (model.kind === 'byok') {
    const label = findEndpoint(model.endpoint)?.label ?? 'the provider';
    if (!needsKey) return null;
    chip = owner ? `Uses ${owner}'s key` : `Needs a ${label} key`;
    text = owner
      ? `Only ${owner} can send with this model. Ask ${owner} to press Send, add your own ${label} key, or pick a model you can use.`
      : `Add your own ${label} key to send, or pick a model you can use.`;
  } else {
    if (!owner) return null;
    chip = model.kind === 'webllm' ? `Runs in ${owner}'s browser` : `Runs on ${owner}'s computer`;
    text = `To press Send yourself you need ${model.kind === 'webllm' ? 'the in-browser model' : 'Ollama'} too - or ask ${owner}.`;
  }
  return (
    <div
      className="mt-2.5 flex flex-wrap items-center gap-2.5 text-xs text-text-muted"
      data-testid="model-notice"
    >
      <span className="inline-flex h-7 items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 font-semibold text-text">
        {setter ? <Avatar person={setter} size={18} /> : null}
        {chip}
      </span>
      <span className="min-w-0 flex-1">{text}</span>
      <Button size="sm" onClick={onChange}>
        Change model
      </Button>
    </div>
  );
}

/** The live demo room (/demo): its banner; no sharing, the demo model only, nothing saved. */
export interface DemoRoom {
  banner: ReactNode;
}

export function RoomView({
  session,
  openShare,
  demo,
}: {
  session: RoomSession;
  openShare: boolean;
  demo?: DemoRoom;
}) {
  const snap = useRoomSnapshot(session);
  const navigate = useNavigate();
  const [shareOpen, setShareOpen] = useState(openShare);
  const [renameOpen, setRenameOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportUsed, setExportUsed] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: 'remove'; person: PersonView } | { kind: 'delete' } | null
  >(null);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!accessNotice) return;
    const timer = setTimeout(() => {
      setAccessNotice(null);
    }, 6000);
    return () => {
      clearTimeout(timer);
    };
  }, [accessNotice]);
  const [params, setParams] = useSearchParams();
  const desktop = useMedia('(min-width: 768px)');
  const [tab, setTab] = useState<'chat' | 'context' | 'people' | 'tree'>(() =>
    params.get('panel') === 'context' && !matchesMedia('(min-width: 768px)') ? 'context' : 'chat',
  );
  const [ctxOpen, setCtxOpen] = useState(() => matchesMedia('(min-width: 1100px)'));
  const [ctxTab, setCtxTab] = useState<PanelTab>('context');
  // mockup 05: the context list takes the main area (desktop only)
  const wide = desktop && params.get('panel') === 'context';
  const setWide = (on: boolean) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (on) next.set('panel', 'context');
        else next.delete('panel');
        return next;
      },
      { replace: true },
    );
    if (on) setCtxOpen(true);
  };
  const [panel, setPanel] = useState<'people' | 'tree'>('people');
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [forkOpen, setForkOpen] = useState(false);
  const [merge, setMerge] = useState<MergePlan | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [showAuthors, setShowAuthors] = useState(true);
  const [hoverAuthor, setHoverAuthor] = useState<{ name: string; x: number; y: number } | null>(
    null,
  );
  const [seenBranch, setSeenBranch] = useState(snap.activeBranch);
  const [switchNotice, setSwitchNotice] = useState<{ by: string; to: string; from: string } | null>(
    null,
  );
  // "Kabir switched the room to shorter-version" (mockup 12 D) - derived while rendering.
  if (seenBranch !== snap.activeBranch) {
    setSeenBranch(snap.activeBranch);
    const by = snap.activeBranchBy;
    if (by && by !== snap.me.pid) {
      setSwitchNotice({ by, to: snap.activeBranch, from: seenBranch });
    } else {
      setSwitchNotice(null);
    }
  }
  useEffect(() => {
    if (!switchNotice) return;
    const t = setTimeout(() => {
      setSwitchNotice(null);
    }, 8000);
    return () => {
      clearTimeout(t);
    };
  }, [switchNotice]);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelFocus, setModelFocus] = useState<ProviderKind | undefined>(undefined);
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<Retry | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useKeyStore();
  const context = useContextBudget(session, snap);
  const tokensFor = useRef(context.tokensFor);
  useEffect(() => {
    tokensFor.current = context.tokensFor;
  }, [context.tokensFor]);

  const openModel = useCallback(
    (focus?: ProviderKind) => {
      if (demo) {
        setNotice(
          'The demo room always uses the demo model. Start your own room to use your own key, an in-browser model or Ollama.',
        );
        return;
      }
      setModelFocus(focus);
      setModelOpen(true);
    },
    [demo],
  );

  const me = snap.me;
  const host = snap.people.find((p) => p.host);
  const iAmHost = snap.settings?.hostPid === me.pid;
  const canManage = snap.managed && iAmHost;
  const toggleLock = () => {
    const next = !snap.locked;
    void session.setLocked(next).then((res) => {
      setAccessNotice(
        res.ok
          ? next
            ? 'Room locked: new people cannot join. People already here can come back.'
            : 'Room unlocked: anyone with the code can join.'
          : res.reason === 'offline'
            ? 'You are offline: the lock was not changed.'
            : 'Only the host can lock the room.',
      );
    });
  };
  const hostOnly = snap.settings?.sendPolicy === 'host';
  const online = snap.state === 'synced' || snap.state === 'alone';
  const lockedByOther = snap.lock !== null && snap.lock.session !== session.sync.id;
  const sendingMine = snap.lock !== null && snap.lock.session === session.sync.id;
  const model = snap.model;
  const needsKey = model.kind === 'byok' && !keys.has(model.endpoint ?? '');
  const blocked: string | null = !online
    ? 'Send works again when you are back online.'
    : hostOnly && !iAmHost
      ? `Only ${host?.name ?? 'the host'} (host) can press Send in this room.`
      : lockedByOther
        ? `Send is free again when ${snap.lock?.name ?? 'their'}'s answer ends.`
        : context.budget.over > 0
          ? `Too long for this model: remove about ${context.budget.over.toLocaleString('en-US')} tokens (see Context).`
          : null;

  const send = useCallback(
    (retryText?: Retry) => {
      const s = session.getSnapshot();
      const choice = s.model;
      if (choice.kind === 'byok' && !keys.has(choice.endpoint ?? '')) {
        setPendingRetry(retryText);
        setAddKeyOpen(true);
        return;
      }
      if (choice.kind === 'webllm' && !isWebLlmReady(choice.model)) {
        setNotice('Start the in-browser model first - it downloads once, then answers at once.');
        openModel('webllm');
        return;
      }
      setNotice(null);
      void sendPrompt(session, retryText, (text) => tokensFor.current(text)).then((r) => {
        if (r.ok) return;
        if (r.reason === 'lost' || r.reason === 'busy') {
          setNotice(`${r.holder?.name ?? 'Someone else'} pressed Send first.`);
        }
      });
    },
    [session, keys, openModel],
  );

  if (snap.ended) {
    return <RoomBlocked reason={snap.ended} code={session.code} name={snap.settings?.name} />;
  }
  if (snap.full) return <RoomFull name={snap.settings?.name ?? null} />;

  const title = snap.settings?.name ?? formatRoomCode(session.code);
  const others = snap.people.length - 1;
  const localOnly = realtimeConfig.mode === 'none';
  const branchName = (id: string) => snap.branches.find((b) => b.id === id)?.name ?? id;
  const turnById = (id: string) => snap.turns.find((t) => t.id === id) ?? null;
  const compareA = comparing && selected.length === 2 ? turnById(selected[0] ?? '') : null;
  const compareB = comparing && selected.length === 2 ? turnById(selected[1] ?? '') : null;
  const showTree = tab === 'tree' || (tab !== 'people' && panel === 'tree');

  const openMerge = (fromBranch: string) => {
    setMerge(planMerge(session.doc, fromBranch, snap.activeBranch));
  };
  const switchBranch = (id: string) => {
    setActiveBranch(session.doc, id, me.pid);
    setComparing(false);
  };

  return (
    <div className="flex h-dvh flex-col">
      {demo?.banner}
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
            {demo ? 'Demo' : session.code} · {snap.people.length}{' '}
            {snap.people.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        {snap.activeBranch !== MAIN_BRANCH ? (
          <span
            className="flex-none rounded-pill bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent"
            data-testid="branch-chip"
          >
            {branchName(snap.activeBranch)}
          </span>
        ) : null}
        {demo ? null : (
          <>
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
          </>
        )}
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
        <Button
          size="sm"
          onClick={() => {
            openModel();
          }}
          aria-label={`Model: ${modelLabel(snap.model)}. Change model`}
          data-testid="model-button"
        >
          <span className="size-2 rounded-full bg-success" aria-hidden="true" />
          <span className="max-md:hidden">Model:</span> {modelLabel(snap.model, true)}
        </Button>
        {canManage ? (
          <Button
            size="sm"
            className="max-md:hidden"
            aria-pressed={snap.locked}
            onClick={toggleLock}
            data-testid="lock-button"
          >
            {snap.locked ? 'Unlock' : 'Lock'}
          </Button>
        ) : snap.locked ? (
          <span
            className="flex-none rounded-pill bg-surface-2 px-2.5 py-1 text-xs font-semibold max-md:hidden"
            data-testid="locked-chip"
          >
            Locked
          </span>
        ) : null}
        <RoomMenu
          onShare={
            demo
              ? undefined
              : () => {
                  setShareOpen(true);
                }
          }
          onRename={() => {
            setRenameOpen(true);
          }}
          onLeave={() => {
            session.stop();
            void navigate('/');
          }}
          onExport={() => {
            setExportUsed(true);
            setExportOpen(true);
          }}
          lock={canManage ? { locked: snap.locked, toggle: toggleLock } : undefined}
          onDelete={
            canManage
              ? () => {
                  setConfirm({ kind: 'delete' });
                }
              : undefined
          }
        />
      </header>

      {accessNotice ? (
        <Notice tone="info" testId="access-notice">
          <span>{accessNotice}</span>
        </Notice>
      ) : null}
      {demo ? null : snap.state === 'offline' ? (
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

      <div
        className={cx(
          'grid min-h-0 flex-1 max-md:grid-cols-1',
          wide
            ? 'md:grid-cols-[1fr_360px] lg:grid-cols-[1fr_520px]'
            : ctxOpen
              ? showTree
                ? 'md:grid-cols-[1fr_360px] lg:grid-cols-[400px_1fr_360px]'
                : 'md:grid-cols-[1fr_360px] lg:grid-cols-[260px_1fr_360px]'
              : showTree
                ? 'md:grid-cols-[400px_1fr]'
                : 'md:grid-cols-[260px_1fr]',
        )}
      >
        <aside
          aria-label="Room"
          className={cx(
            'flex flex-col gap-[18px] overflow-auto border-r border-border bg-surface p-4',
            tab === 'people' || tab === 'tree' ? 'max-md:flex' : 'max-md:hidden',
            wide ? 'md:hidden' : ctxOpen ? 'md:max-lg:hidden' : '',
          )}
        >
          <div
            className="flex gap-1 rounded-md bg-surface-2 p-1 max-md:hidden"
            role="tablist"
            aria-label="Side panel"
          >
            {(['people', 'tree'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={panel === p}
                onClick={() => {
                  setPanel(p);
                }}
                className={cx(
                  'h-8 flex-1 rounded-sm text-sm font-semibold',
                  panel === p ? 'bg-surface text-text shadow-sm' : 'text-text-muted',
                )}
                data-testid={`panel-${p}`}
              >
                {p === 'people'
                  ? `People (${String(snap.people.length)})`
                  : `Tree (${String(snap.branches.length)})`}
              </button>
            ))}
          </div>
          {showTree ? (
            <Tree
              turns={snap.turns}
              branches={snap.branches}
              activeBranch={snap.activeBranch}
              labels={snap.labels}
              roster={snap.roster}
              me={me.pid}
              selected={selected}
              merges={snap.merges}
              actions={{
                onToggleSelect: (id) => {
                  setSelected((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2),
                  );
                },
                onBranchFrom: (id) => {
                  setBranchFrom(id);
                },
                onCompare: () => {
                  setComparing(true);
                  setTab('chat');
                },
                onSwitch: switchBranch,
                onRename: (id) => {
                  setRenaming(id);
                },
                onMerge: openMerge,
                onFork: () => {
                  setForkOpen(true);
                },
              }}
            />
          ) : (
            <PeopleList
              people={snap.people}
              manage={
                canManage
                  ? {
                      makeHost: (p) => {
                        void session.makeHost(p.pid).then((res) => {
                          setAccessNotice(
                            res.ok
                              ? `${p.name} is the host now.`
                              : 'The host could not be changed. Try again.',
                          );
                        });
                      },
                      remove: (p) => {
                        setConfirm({ kind: 'remove', person: p });
                      },
                    }
                  : undefined
              }
            />
          )}
          <section className={cx('mt-auto', showTree && 'hidden')} aria-labelledby="room-h">
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
            {snap.managed ? (
              <p className="mt-1.5 flex justify-between text-sm" data-testid="room-lock">
                <span>Room lock</span>
                <b>{snap.locked ? 'Locked' : 'Open'}</b>
              </p>
            ) : null}
          </section>
        </aside>

        <main
          className={cx('flex min-h-0 min-w-0 flex-col', tab === 'chat' ? '' : 'max-md:hidden')}
          aria-label="Shared prompt and answers"
        >
          <div
            className={cx(
              'flex flex-1 overflow-auto p-8 max-md:p-4',
              snap.path.length === 0 && !compareA && !wide && 'items-center justify-center',
            )}
          >
            {wide ? (
              <ContextWide session={session} snap={snap} data={context} />
            ) : compareA && compareB ? (
              <Compare
                a={compareA}
                b={compareB}
                labels={snap.labels}
                branchName={branchName}
                roster={snap.roster}
                me={me.pid}
                activeBranchName={branchName(snap.activeBranch)}
                canMerge={compareB.branchId !== snap.activeBranch}
                onMerge={() => {
                  openMerge(compareB.branchId);
                }}
                onClose={() => {
                  setComparing(false);
                }}
              />
            ) : snap.path.length === 0 ? (
              <p
                className="max-w-[420px] text-center text-sm text-text-muted"
                data-testid="thread-empty"
              >
                Write the prompt together below - every keystroke shows up on every screen. When
                someone presses Send, the answer streams in here for everyone.
              </p>
            ) : (
              <Thread
                turns={snap.path}
                people={snap.people}
                ctx={{
                  roster: snap.roster,
                  labels: snap.labels,
                  showAuthors,
                  branchName,
                }}
                actions={{
                  onBranchFrom: (id) => {
                    setBranchFrom(id);
                  },
                  onStop: (id) => {
                    session.stream.requestStop(id);
                  },
                  onRetry: (turn: TurnView) => {
                    send({ text: turn.prompt.text, spans: turn.prompt.spans });
                  },
                  onChangeModel: () => {
                    openModel();
                  },
                  onUpdateKey: (turn: TurnView) => {
                    openModel(turn.provider.kind === 'byok' ? 'byok' : undefined);
                  },
                }}
              />
            )}
          </div>
          <div
            className={cx(
              'border-t border-border bg-surface px-6 pt-3.5 pb-4 max-md:p-3',
              wide && 'hidden',
            )}
          >
            <p
              className="mb-2 text-xs text-text-muted"
              aria-live="polite"
              data-testid="sync-status"
            >
              <b className="text-text">Shared prompt</b>
              {snap.activeBranch !== MAIN_BRANCH
                ? ` · ${branchName(snap.activeBranch)}`
                : ''} · {statusLine(snap, demo !== undefined)}
              <button
                type="button"
                aria-pressed={showAuthors}
                onClick={() => {
                  setShowAuthors((v) => !v);
                }}
                className="ml-3 inline-flex items-center gap-1.5 align-middle font-semibold text-text"
                data-testid="show-authors"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'relative inline-block h-4 w-7 rounded-pill transition-colors',
                    showAuthors ? 'bg-accent' : 'bg-border-strong',
                  )}
                >
                  <span
                    className={cx(
                      'absolute top-0.5 size-3 rounded-full bg-surface transition-[left]',
                      showAuthors ? 'left-[14px]' : 'left-0.5',
                    )}
                  />
                </span>
                Show authors
              </button>
            </p>
            <AuthorStyles roster={snap.roster} show={showAuthors} />
            {snap.savedLocally && snap.state !== 'connecting' ? (
              <div
                className={cx(showAuthors && 'pa-show-authors')}
                onMouseOver={(e) => {
                  const el = (e.target as HTMLElement).closest('[data-author]');
                  const uid = el?.getAttribute('data-author') ?? '';
                  if (!el || !uid || !showAuthors) {
                    setHoverAuthor(null);
                    return;
                  }
                  const r = el.getBoundingClientRect();
                  setHoverAuthor({
                    name: authorName(snap.roster, uid, me.pid),
                    x: r.left,
                    y: r.top,
                  });
                }}
                onMouseLeave={() => {
                  setHoverAuthor(null);
                }}
                onKeyDownCapture={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!blocked && !sendingMine) send();
                  }
                }}
              >
                <PromptEditor
                  key={snap.activeBranch}
                  session={session}
                  branchId={snap.activeBranch}
                />
              </div>
            ) : (
              // Starting the editor before the first sync would add a second empty paragraph.
              <div className="pa-editor text-text-muted" role="status" data-testid="prompt-loading">
                Loading the shared prompt…
              </div>
            )}
            <ModelNotice
              model={model}
              people={snap.people}
              needsKey={needsKey}
              onChange={() => {
                openModel();
              }}
            />
            <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
              <Button
                size="sm"
                aria-expanded={desktop ? ctxOpen : tab === 'context'}
                onClick={() => {
                  if (desktop) setCtxOpen((open) => !open);
                  else setTab('context');
                  setCtxTab('context');
                }}
                data-testid="context-button"
              >
                + Context
                <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-[11px]">
                  {snap.context.filter((i) => i.included).length}
                </span>
              </Button>
              <span
                className={cx(
                  'font-mono text-xs',
                  context.budget.over > 0 ? 'font-semibold text-danger' : 'text-text-muted',
                )}
                data-testid="composer-tokens"
              >
                {context.exact ? '' : 'about '}
                {context.budget.used.toLocaleString('en-US')} /{' '}
                {context.budget.limit.toLocaleString('en-US')} tokens
              </span>
              <p
                className="mr-auto min-w-0 text-xs text-text-muted"
                aria-live="polite"
                data-testid="send-hint"
              >
                {notice ?? blocked ?? ''}
              </p>
              <span className="text-xs text-text-muted max-md:hidden" aria-hidden="true">
                <kbd className="rounded-sm border border-border-strong px-1 font-mono">Ctrl</kbd>{' '}
                <kbd className="rounded-sm border border-border-strong px-1 font-mono">Enter</kbd>
              </span>
              <Button
                variant="primary"
                className="min-w-[96px]"
                disabled={blocked !== null || sendingMine}
                onClick={() => {
                  send();
                }}
                data-testid="send-button"
              >
                {sendingMine
                  ? 'Sending…'
                  : lockedByOther
                    ? `${snap.lock?.name ?? 'Someone'} is sending…`
                    : 'Send'}
              </Button>
            </div>
          </div>
        </main>

        <aside
          aria-label="Context"
          className={cx(
            'min-h-0 flex-col border-l border-border bg-surface max-md:border-l-0',
            tab === 'context' ? 'max-md:flex' : 'max-md:hidden',
            ctxOpen || wide ? 'md:flex' : 'md:hidden',
          )}
          data-testid="context-panel"
        >
          <ContextPanel
            session={session}
            snap={snap}
            data={context}
            tab={ctxTab}
            onTab={setCtxTab}
            wide={wide}
            onWide={setWide}
            onClose={() => {
              setCtxOpen(false);
            }}
            onChangeModel={() => {
              openModel();
            }}
          />
        </aside>
      </div>

      <nav
        aria-label="Room sections"
        className="flex h-[60px] flex-none border-t border-border bg-surface md:hidden"
      >
        {(['chat', 'context', 'tree', 'people'] as const).map((t) => (
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
            {t === 'chat'
              ? 'Chat'
              : t === 'context'
                ? `Context (${snap.context.length})`
                : t === 'people'
                  ? `People (${snap.people.length})`
                  : 'Tree'}
          </button>
        ))}
      </nav>

      {hoverAuthor ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 rounded-sm bg-text px-2 py-1 text-xs font-semibold text-bg"
          style={{ left: hoverAuthor.x, top: Math.max(4, hoverAuthor.y - 28) }}
        >
          Written by {hoverAuthor.name}
        </div>
      ) : null}
      {switchNotice ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-text px-4 py-3 text-sm text-bg shadow-lg max-md:inset-x-3 max-md:top-[64px] max-md:bottom-auto max-md:translate-x-0 max-md:justify-between"
          data-testid="switch-notice"
        >
          <span>
            {authorName(snap.roster, switchNotice.by, me.pid)} switched the room to{' '}
            <b>{branchName(switchNotice.to)}</b>
          </span>
          <button
            type="button"
            className="rounded-md border border-bg/40 px-2.5 py-1 font-semibold"
            onClick={() => {
              switchBranch(switchNotice.from);
              setSwitchNotice(null);
            }}
          >
            Back to {branchName(switchNotice.from)}
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            className="-mr-1 px-1.5 font-semibold"
            onClick={() => {
              setSwitchNotice(null);
            }}
          >
            ✕
          </button>
        </div>
      ) : null}
      <BranchDialog
        open={branchFrom !== null}
        onOpenChange={(o) => {
          if (!o) setBranchFrom(null);
        }}
        turn={branchFrom ? turnById(branchFrom) : null}
        turnLabel={branchFrom ? (snap.labels[branchFrom] ?? '') : ''}
        taken={snap.branches.map((b) => b.name)}
        onCreate={(name, switchNow) => {
          const from = branchFrom ? turnById(branchFrom) : null;
          if (!from) return;
          const created = createBranch(session.doc, {
            id: crypto.randomUUID(),
            name,
            fromTurnId: from.id,
            sourceBranch: from.branchId,
            by: me.pid,
            at: Date.now(),
          });
          if (created && switchNow) switchBranch(created.id);
          setSelected([]);
        }}
      />
      <ForkDialog
        open={forkOpen}
        onOpenChange={setForkOpen}
        path={snap.path}
        labels={snap.labels}
        branchName={branchName(snap.activeBranch)}
        roomName={title}
        roomCode={session.code}
        onFork={(upto, name) => {
          const payload = forkPayload(session.doc, {
            branchId: snap.activeBranch,
            uptoTurnId: upto,
            fromCode: session.code,
            names: (pid) => snap.roster[pid] ?? null,
          });
          if (!payload) return;
          void navigate(`/r/${createRoomCode()}`, {
            state: {
              create: { name, sendPolicy: snap.settings?.sendPolicy ?? 'everyone', fork: payload },
              share: true,
            },
          });
        }}
      />
      <MergeDialog
        open={merge !== null}
        onOpenChange={(o) => {
          if (!o) setMerge(null);
        }}
        plan={merge}
        fromName={merge ? branchName(merge.from) : ''}
        intoName={merge ? branchName(merge.into) : ''}
        roster={snap.roster}
        me={me.pid}
        onMerge={(choices) => {
          if (!merge) return;
          // re-plan against the latest drafts so nothing typed meanwhile is lost
          const fresh = planMerge(session.doc, merge.from, merge.into);
          applyMerge(session.doc, fresh.conflicts === merge.conflicts ? fresh : merge, choices, {
            id: crypto.randomUUID(),
            by: me.pid,
            at: Date.now(),
          });
          setComparing(false);
        }}
      />
      <RenameBranchDialog
        open={renaming !== null}
        onOpenChange={(o) => {
          if (!o) setRenaming(null);
        }}
        current={renaming ? branchName(renaming) : ''}
        taken={snap.branches.map((b) => b.name)}
        onRename={(name) => {
          if (renaming) renameBranch(session.doc, renaming, name);
        }}
      />
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        code={session.code}
        here={snap.people.length}
      />
      <ModelDialog
        open={modelOpen}
        onOpenChange={setModelOpen}
        current={model}
        myName={me.name}
        {...(modelFocus ? { focus: modelFocus } : {})}
        onUse={(choice: RoomModelChoice) => {
          setRoomModel(session.doc, { ...choice, setBy: me.pid });
          setNotice(null);
        }}
      />
      <AddKeyDialog
        open={addKeyOpen}
        onOpenChange={setAddKeyOpen}
        choice={model}
        myName={me.name}
        onSaved={() => {
          void sendPrompt(session, pendingRetry, (text) => tokensFor.current(text));
        }}
        onUseDemo={() => {
          setRoomModel(session.doc, { ...DEFAULT_MODEL, setBy: me.pid });
        }}
      />
      {exportUsed ? (
        <Suspense fallback={null}>
          <ExportDialog
            open={exportOpen}
            onOpenChange={setExportOpen}
            session={session}
            snap={snap}
          />
        </Suspense>
      ) : null}
      <DialogShell
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.kind === 'remove'
            ? `Remove ${confirm.person.name}?`
            : 'Delete this room for everyone?'
        }
        footer={
          <>
            <Button
              onClick={() => {
                setConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              data-testid="confirm-access"
              onClick={() => {
                const what = confirm;
                setConfirm(null);
                if (what?.kind === 'remove') {
                  void session.removePerson(what.person.pid).then((res) => {
                    setAccessNotice(
                      res.ok
                        ? `${what.person.name} was removed and cannot come back.`
                        : `${what.person.name} could not be removed. Try again.`,
                    );
                  });
                } else if (what?.kind === 'delete') {
                  void session.deleteRoom().then((res) => {
                    if (!res.ok) setAccessNotice('The room could not be deleted. Try again.');
                  });
                }
              }}
            >
              {confirm?.kind === 'remove' ? 'Remove' : 'Delete room'}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {confirm?.kind === 'remove'
            ? `${confirm.person.name} leaves the room now and cannot join it again from that browser. What they wrote stays, with their name on it.`
            : "The room, its saved copy and everyone's seat are deleted from the server now. People who have it open are sent out. Copies already saved on their devices are not touched. Export first if you want to keep the conversation."}
        </p>
      </DialogShell>
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
