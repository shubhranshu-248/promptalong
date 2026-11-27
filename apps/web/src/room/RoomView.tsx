import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  addPin,
  pinOf,
  removePin,
  cleanDisplayName,
  formatRoomCode,
  promptFragment,
  removedPeople,
  setRoomModel,
  type PinView,
  type TurnView,
} from '@promptalong/core';
import {
  DEFAULT_MODEL,
  findEndpoint,
  modelLabel,
  type ProviderKind,
  type RoomModelChoice,
} from '@promptalong/providers';
import { Button, buttonClass, cx } from '@promptalong/ui';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import * as Y from 'yjs';
import { ContextPanel, type PanelTab } from '../context/ContextPanel';
import { useContextBudget } from '../context/useContextBudget';
import { matchesMedia, useMedia } from '../context/useMedia';
import { useKeyStore } from '../keys/useKeyStore';
import { AddKeyDialog, ModelDialog } from '../models/ModelDialog';
import { isWebLlmReady } from '../models/webllm-state';
import { realtimeConfig } from '../realtime';
import { ThemeToggle } from '../components/ThemeToggle';
import {
  getThemePreference,
  onThemeChange,
  setThemePreference,
  type ThemePreference,
} from '../theme';
import { RoomBlocked } from './access';
import { Composer } from './Composer';
import { DialogShell, RenameDialog, ShareDialog } from './dialogs';
import { CheckIcon, LinkIcon, MoreIcon, SidebarIcon } from './icons';
import { saveDisplayName } from './identity';
import { sendPrompt, type Retry } from './send';
import type { PersonView, RoomSession, RoomSnapshot } from './session';
import type { SessionConn, SessionSnapshot } from './session-conn';
import { PinDialog, PinnedList } from './Pins';
import { sessionProblem } from './session-problem';
import { SearchDialog } from './SearchDialog';
import { SessionDialog, SessionList, type Candidate } from './Sessions';
import type { SessionView } from './session';
import { Avatar, Sidebar } from './Sidebar';
import { STARTERS } from './starters';
import { Thread } from './Thread';
import { useRoomSnapshot, useSessionSnapshot } from './useRoomSession';

/** Export is rarely opened: its code is loaded when it is. */
const ExportDialog = lazy(() => import('../export/ExportDialog'));

const menuItem =
  'flex cursor-default items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium outline-none data-[highlighted]:bg-surface-2';

/**
 * Puts an earlier prompt back into the (empty) shared prompt, each part marked with the person who
 * wrote it, so it can be changed and sent again. False when the shared prompt has text.
 */
function restorePrompt(
  session: SessionConn,
  text: string,
  spans: { from: number; to: number; uid: string }[],
): boolean {
  const paragraph = promptFragment(session.doc).get(0);
  if (!(paragraph instanceof Y.XmlElement)) return false;
  const node = paragraph.get(0);
  if (!(node instanceof Y.XmlText)) return false;
  const now = (node.toDelta() as { insert?: unknown }[])
    .map((d) => (typeof d.insert === 'string' ? d.insert : ''))
    .join('');
  if (now.trim().length > 0) return false;
  session.doc.transact(() => {
    node.delete(0, node.length);
    let at = 0;
    const sorted = [...spans].sort((a, b) => a.from - b.from);
    for (const s of sorted) {
      if (s.from > at) node.insert(node.length, text.slice(at, s.from));
      node.insert(node.length, text.slice(Math.max(at, s.from), s.to), { author: { uid: s.uid } });
      at = Math.max(at, s.to);
    }
    if (at < text.length) node.insert(node.length, text.slice(at));
  });
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-testid="prompt-editor"]')?.focus();
  });
  return true;
}

/** Adds text to the end of the shared prompt, marked as written by `uid`. */
function addToPrompt(session: SessionConn, text: string, uid: string): void {
  const paragraph = promptFragment(session.doc).get(0);
  if (!(paragraph instanceof Y.XmlElement)) return;
  const node = paragraph.get(0);
  if (!(node instanceof Y.XmlText)) return;
  const current = (node.toDelta() as { insert?: unknown }[])
    .map((d) => (typeof d.insert === 'string' ? d.insert : ''))
    .join('');
  session.doc.transact(() => {
    node.insert(node.length, current.trim() ? ` ${text}` : text, { author: { uid } });
  });
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-testid="prompt-editor"]')?.focus();
  });
}

function RoomMenu({
  onShare,
  onRename,
  onLeave,
  onExport,
  showAuthors,
  onShowAuthors,
  lock,
  onDelete,
}: {
  /** omitted in the demo room (it cannot be joined) */
  onShare?: (() => void) | undefined;
  onRename: () => void;
  onLeave: () => void;
  onExport: () => void;
  showAuthors: boolean;
  onShowAuthors: (show: boolean) => void;
  /** host of a room with a server: lock or unlock */
  lock?: { locked: boolean; toggle: () => void } | undefined;
  onDelete?: (() => void) | undefined;
}) {
  const theme = useSyncExternalStore(onThemeChange, getThemePreference);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label="Room menu"
          className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <MoreIcon />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-[60] w-[260px] rounded-xl border border-border bg-surface p-1.5 text-text shadow-lg"
        >
          {onShare ? (
            <Menu.Item className={menuItem} onSelect={onShare}>
              Share link and code
            </Menu.Item>
          ) : null}
          <Menu.CheckboxItem
            className={menuItem}
            checked={showAuthors}
            onCheckedChange={(v) => {
              onShowAuthors(v);
            }}
            data-testid="show-authors"
          >
            <span className="w-3" aria-hidden="true">
              <Menu.ItemIndicator>
                <CheckIcon />
              </Menu.ItemIndicator>
            </span>
            Show who wrote what
          </Menu.CheckboxItem>
          <Menu.Item className={menuItem} onSelect={onRename}>
            Change your name
          </Menu.Item>
          {lock ? (
            <Menu.Item className={menuItem} onSelect={lock.toggle} data-testid="menu-lock">
              {lock.locked ? 'Unlock room' : 'Lock room'}
            </Menu.Item>
          ) : null}
          <Menu.Item className={menuItem} onSelect={onExport}>
            Export
          </Menu.Item>
          <Menu.Separator className="mx-1 my-1.5 h-px bg-border" />
          <Menu.Label className="px-3 pt-1 pb-1 text-xs font-medium text-text-muted">
            Theme
          </Menu.Label>
          <Menu.RadioGroup
            value={theme}
            onValueChange={(v) => {
              const pref: ThemePreference = v === 'light' || v === 'dark' ? v : 'system';
              setThemePreference(pref);
            }}
          >
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Menu.RadioItem key={t} value={t} className={menuItem}>
                <span className="w-3" aria-hidden="true">
                  <Menu.ItemIndicator>●</Menu.ItemIndicator>
                </span>
                {t === 'system' ? 'Same as device' : t === 'light' ? 'Light' : 'Dark'}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Menu.Separator className="mx-1 my-1.5 h-px bg-border" />
          <Menu.Item className={cx(menuItem, 'text-danger')} onSelect={onLeave}>
            Leave room
          </Menu.Item>
          {onDelete ? (
            <Menu.Item className={cx(menuItem, 'text-danger')} onSelect={onDelete}>
              Delete room for everyone…
            </Menu.Item>
          ) : null}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function statusLine(s: RoomSnapshot, ss: SessionSnapshot, demo: boolean): string {
  if (s.state === 'offline' || ss.state === 'offline') {
    return 'Offline. Your edits are saved on this device.';
  }
  if (s.state === 'connecting' || ss.state === 'connecting') return 'Connecting…';
  if (!s.savedLocally || !ss.savedLocally) return 'Loading…';
  if (demo) return 'Demo room: nothing here is saved.';
  const others = ss.people.length - 1;
  return others > 0
    ? `${String(ss.people.length)} people in this session. Everything syncs as you type.`
    : 'Saved. Everything syncs as soon as someone opens this session.';
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
    <div className="flex flex-none justify-center px-4 pt-3">
      <div
        role="status"
        data-testid={testId}
        className={cx(
          'flex max-w-[760px] items-center gap-2.5 rounded-pill px-4 py-2 text-sm',
          tone === 'warn' ? 'bg-warning-bg text-warning-text' : 'bg-accent-soft text-text',
        )}
      >
        {children}
      </div>
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

/** The room's model runs on someone's key or computer: say who can press Send with it. */
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
  let text: string;
  if (model.kind === 'byok') {
    const label = findEndpoint(model.endpoint)?.label ?? 'the provider';
    if (!needsKey) return null;
    text = owner
      ? `This model uses ${owner}'s key, so only ${owner} can send with it. Add your own ${label} key, or pick another model.`
      : `Add your own ${label} key to send, or pick a model you can use.`;
  } else {
    if (!owner) return null;
    text = `This model runs on ${owner}'s ${model.kind === 'webllm' ? 'browser' : 'computer'}. To send yourself, start ${model.kind === 'webllm' ? 'the in-browser model' : 'Ollama'} too, or ask ${owner}.`;
  }
  return (
    <div
      className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 text-xs text-text-muted"
      data-testid="model-notice"
    >
      {setter ? <Avatar person={setter} size={18} /> : null}
      <span>{text}</span>
      <button type="button" className="font-semibold text-accent underline" onClick={onChange}>
        Change model
      </button>
    </div>
  );
}

function EmptyRoom({
  hostOnly,
  hostName,
  iAmHost,
  alone,
  code,
  starters,
  onStarter,
}: {
  hostOnly: boolean;
  hostName: string | null;
  iAmHost: boolean;
  alone: boolean;
  code: string | null;
  starters: boolean;
  onStarter: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = code ? `${window.location.origin}/r/${code}` : '';
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col items-center pt-[10vh] text-center max-md:pt-[6vh]">
      <h2 className="text-[30px] font-semibold tracking-[-0.03em] max-md:text-[24px]">
        What should we ask together?
      </h2>
      <p className="mt-3 max-w-[480px] text-[15px] text-text-muted" data-testid="thread-empty">
        Everyone here writes the prompt below at the same time.{' '}
        {hostOnly
          ? iAmHost
            ? 'Only you can send it.'
            : `Only ${hostName ?? 'the host'} can send it.`
          : 'Anyone can send it.'}{' '}
        The answer streams to every screen.
      </p>
      {starters ? (
        <ul
          className="mt-8 grid w-full grid-cols-1 gap-2.5 md:grid-cols-3"
          aria-label="Prompt ideas"
        >
          {STARTERS.map((text) => (
            <li key={text}>
              <button
                type="button"
                onClick={() => {
                  onStarter(text);
                }}
                className="h-full w-full rounded-2xl border border-border bg-surface px-4 py-3.5 text-left text-sm leading-snug text-text transition-colors hover:border-border-strong"
                data-testid="starter"
              >
                {text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {alone && code ? (
        <div
          className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl bg-surface-2 px-4 py-3 text-sm"
          data-testid="alone-banner"
          role="status"
        >
          <span>
            <b className="font-semibold">No one else is here yet.</b> Send them the link or the code{' '}
            <span className="font-mono font-semibold">{formatRoomCode(code)}</span>.
          </span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(
                () => {
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                  }, 1800);
                },
                () => undefined,
              );
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-primary-btn-bg px-3 text-xs font-semibold text-primary-btn-text"
          >
            {copied ? <CheckIcon /> : <LinkIcon />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      ) : null}
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
  if (snap.ended) {
    return <RoomBlocked reason={snap.ended} code={session.code} name={snap.settings?.name} />;
  }
  if (snap.full) return <RoomFull name={snap.settings?.name ?? null} />;
  const conn = snap.activeId ? session.conn(snap.activeId) : null;
  if (!conn) {
    return (
      <div className="grid h-dvh place-items-center bg-bg px-6 text-center">
        <p className="text-sm text-text-muted" role="status" data-testid="sessions-loading">
          {snap.sessionsLoaded
            ? 'You are not in any session of this room yet. The host can add you to one.'
            : 'Opening the room…'}
        </p>
      </div>
    );
  }
  return (
    <RoomWorkspace
      session={session}
      snap={snap}
      conn={conn}
      openShare={openShare}
      {...(demo ? { demo } : {})}
    />
  );
}

function RoomWorkspace({
  session,
  snap,
  conn,
  openShare,
  demo,
}: {
  session: RoomSession;
  snap: RoomSnapshot;
  conn: SessionConn;
  openShare: boolean;
  demo?: DemoRoom;
}) {
  const ss = useSessionSnapshot(session, conn);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [shareOpen, setShareOpen] = useState(openShare);
  const [renameOpen, setRenameOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportUsed, setExportUsed] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: 'remove'; person: PersonView } | { kind: 'delete' } | null
  >(null);
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  const [sessionDialog, setSessionDialog] = useState<{ editing: SessionView | null } | null>(null);
  const [deleting, setDeleting] = useState<SessionView | null>(null);
  const [openPin, setOpenPin] = useState<PinView | null>(null);
  const [comparing, setComparing] = useState<TurnView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  // what is new in the other sessions shows in the browser tab, so a background tab says so
  const unreadElsewhere = snap.sessions
    .filter((s) => s.id !== conn.id)
    .reduce((n, s) => n + s.unread, 0);
  const tabName = snap.settings?.name ?? formatRoomCode(session.code);
  useEffect(() => {
    const before = document.title;
    document.title = `${unreadElsewhere > 0 ? `(${String(unreadElsewhere)}) ` : ''}${tabName} · PromptAlong`;
    return () => {
      document.title = before;
    };
  }, [unreadElsewhere, tabName]);
  useEffect(() => {
    if (!accessNotice) return;
    const timer = setTimeout(() => {
      setAccessNotice(null);
    }, 6000);
    return () => {
      clearTimeout(timer);
    };
  }, [accessNotice]);
  const wideScreen = useMedia('(min-width: 1100px)');
  const xl = useMedia('(min-width: 1280px)');
  const [sidebarOpen, setSidebarOpen] = useState(() => matchesMedia('(min-width: 1100px)'));
  // the sidebar is part of the layout on wide screens and a drawer on small ones: when the window
  // crosses that width, it follows (an open drawer must not end up covering a phone's screen)
  const [sidebarWide, setSidebarWide] = useState(wideScreen);
  if (sidebarWide !== wideScreen) {
    setSidebarWide(wideScreen);
    setSidebarOpen(wideScreen);
  }
  const [ctxOpen, setCtxOpen] = useState(() => params.get('panel') === 'context');
  const [ctxTab, setCtxTab] = useState<PanelTab>('context');
  const [showAuthors, setShowAuthors] = useState(true);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelFocus, setModelFocus] = useState<ProviderKind | undefined>(undefined);
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<Retry | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useKeyStore();
  const context = useContextBudget(session, snap, conn, ss);
  const tokensFor = useRef(context.tokensFor);
  useEffect(() => {
    tokensFor.current = context.tokensFor;
  }, [context.tokensFor]);

  // the drawers are overlays on small screens: Escape closes them
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Escape inside a dialog or menu closes that, not the drawer behind it
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (ctxOpen && !matchesMedia('(min-width: 1280px)')) setCtxOpen(false);
      else if (sidebarOpen && !matchesMedia('(min-width: 1100px)')) setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxOpen, sidebarOpen]);

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
  const lockedByOther = ss.lock !== null && ss.lock.session !== conn.sync.id;
  const sendingMine = ss.lock !== null && ss.lock.session === conn.sync.id;
  const model = ss.model;
  const needsKey = model.kind === 'byok' && !keys.has(model.endpoint ?? '');
  const blocked: string | null = !online
    ? 'Send works again when you are back online.'
    : hostOnly && !iAmHost
      ? `Only ${host?.name ?? 'the host'} (host) can press Send in this room.`
      : lockedByOther
        ? `Send is free again when ${ss.lock?.name ?? 'their'}'s answer ends.`
        : context.budget.over > 0
          ? `Too long for this model: remove about ${context.budget.over.toLocaleString('en-US')} tokens (see Context).`
          : null;

  const send = useCallback(
    (retryText?: Retry) => {
      const choice = conn.getSnapshot().model;
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
      void sendPrompt(conn, retryText, (text) => tokensFor.current(text)).then((r) => {
        if (r.ok) return;
        if (r.reason === 'lost' || r.reason === 'busy') {
          setNotice(`${r.holder?.name ?? 'Someone else'} pressed Send first.`);
        }
      });
    },
    [conn, keys, openModel],
  );

  const title = snap.settings?.name ?? formatRoomCode(session.code);
  const current = snap.sessions.find((s) => s.id === conn.id) ?? null;
  const several = snap.sessions.length > 1;
  const removed = new Set(removedPeople(session.doc));
  const here = new Set(snap.people.map((p) => p.pid));
  const candidates: Candidate[] = Object.entries(snap.roster)
    .filter(([pid]) => !removed.has(pid))
    .map(([pid, r]) => ({
      pid,
      name: r.name,
      slot: r.slot,
      here: here.has(pid),
      me: pid === me.pid,
    }))
    .sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
  const { shortened, left } = context.assembled.fitted;
  const fitNote =
    shortened.length + left.length === 0
      ? null
      : `To fit ${modelLabel(model)}, ${[
          shortened.length > 0
            ? `${String(shortened.length)} older ${shortened.length === 1 ? 'turn is' : 'turns are'} sent shortened`
            : '',
          left.length > 0
            ? `${String(left.length)} of the oldest ${left.length === 1 ? 'is' : 'are'} left out`
            : '',
        ]
          .filter(Boolean)
          .join(' and ')}. Exact request shows what is sent.`;
  const sessionName = (id: string) =>
    several ? (snap.sessions.find((s) => s.id === id)?.name ?? null) : null;
  const others = snap.people.length - 1;
  const localOnly = realtimeConfig.mode === 'none';
  const streaming = ss.path.find((t) => t.status === 'streaming') ?? null;
  const ready =
    snap.savedLocally &&
    ss.savedLocally &&
    ss.promptReady &&
    snap.state !== 'connecting' &&
    ss.state !== 'connecting';
  const docked = wideScreen; // sidebar is part of the layout from 1100 px
  const overlayOpen = (!docked && sidebarOpen) || (ctxOpen && !xl);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <Sidebar
        open={sidebarOpen}
        onClose={() => {
          setSidebarOpen(false);
        }}
        demo={demo !== undefined}
        code={session.code}
        people={snap.people}
        hostOnly={hostOnly}
        hostName={host?.name ?? null}
        managed={snap.managed}
        locked={snap.locked}
        canManage={canManage}
        onToggleLock={toggleLock}
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
        myName={me.name}
        onRename={() => {
          setRenameOpen(true);
        }}
        sessionName={sessionName}
        onSearch={() => {
          setSearchOpen(true);
        }}
        sessions={
          <>
            {several || canManage ? (
              <SessionList
                sessions={snap.sessions}
                activeId={conn.id}
                roster={snap.roster}
                me={me.pid}
                isHost={iAmHost}
                canManage={canManage}
                onOpen={(id) => {
                  session.setActive(id);
                  if (!matchesMedia('(min-width: 1100px)')) setSidebarOpen(false);
                }}
                onNew={() => {
                  setSessionDialog({ editing: null });
                }}
                onEdit={(s) => {
                  setSessionDialog({ editing: s });
                }}
                onDelete={(s) => {
                  setDeleting(s);
                }}
              />
            ) : null}
            <PinnedList pins={snap.pins} onOpen={setOpenPin} />
          </>
        }
      />
      {overlayOpen ? (
        <button
          type="button"
          aria-label="Close the panel"
          tabIndex={-1}
          className="fixed inset-0 z-[40] bg-[rgba(17,18,24,.32)]"
          onClick={() => {
            setSidebarOpen(docked ? sidebarOpen : false);
            setCtxOpen(false);
          }}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {demo?.banner}
        <header className="flex h-14 flex-none items-center gap-1.5 px-3 max-md:px-2">
          {!sidebarOpen || !docked ? (
            <button
              type="button"
              onClick={() => {
                setSidebarOpen(true);
              }}
              aria-label="Open the sidebar"
              className="grid size-9 flex-none place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
              data-testid="open-sidebar"
            >
              <SidebarIcon />
            </button>
          ) : null}
          <div className="flex min-w-0 items-center gap-2 px-1.5">
            <h1
              className="truncate font-display text-[16px] leading-tight font-semibold"
              data-testid="room-title"
            >
              {title}
              {several && current ? (
                <span className="font-normal text-text-muted" data-testid="session-title">
                  {' / '}
                  {current.name}
                </span>
              ) : null}
            </h1>
            {snap.locked && !canManage ? (
              <span
                className="flex-none rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted"
                data-testid="locked-chip"
              >
                Locked
              </span>
            ) : null}
          </div>
          <span className="flex-1" />
          <span
            className="flex items-center max-md:hidden [&>*+*]:-ml-1.5 [&>*]:ring-2 [&>*]:ring-bg"
            aria-label={`${String(snap.people.length)} people in the room`}
            role="img"
          >
            {snap.people.slice(0, 6).map((p) => (
              <Avatar key={p.pid} person={p} />
            ))}
          </span>
          {demo ? null : (
            <button
              type="button"
              onClick={() => {
                setShareOpen(true);
              }}
              className="ml-2 inline-flex h-9 items-center gap-1.5 rounded-pill border border-border bg-surface px-3.5 text-sm font-medium hover:bg-surface-2"
            >
              <LinkIcon />
              <span className="max-md:hidden">Share link</span>
              <span className="md:hidden">Share</span>
            </button>
          )}
          <ThemeToggle className="ml-1" />
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
            showAuthors={showAuthors}
            onShowAuthors={setShowAuthors}
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
              <b>Offline.</b> Your edits are saved on this device and sync when you are back.
            </span>
          </Notice>
        ) : localOnly ? (
          <Notice tone="info" testId="local-only-banner">
            <span>
              <b>Only on this device.</b> Live sync is not switched on for this site, so others
              cannot join.
            </span>
          </Notice>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <main
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
            aria-label="Shared prompt and answers"
            data-scroll
          >
            <div className="flex-1 px-6 pt-6 pb-8 max-md:px-4">
              {ss.path.length === 0 ? (
                <EmptyRoom
                  hostOnly={hostOnly}
                  hostName={host?.name ?? null}
                  iAmHost={iAmHost}
                  alone={!demo && !localOnly && snap.state === 'alone' && others === 0}
                  code={demo ? null : session.code}
                  starters={!demo}
                  onStarter={(text) => {
                    addToPrompt(conn, text, me.pid);
                  }}
                />
              ) : (
                <Thread
                  turns={ss.path}
                  people={snap.people}
                  ctx={{ roster: snap.roster, showAuthors }}
                  actions={{
                    onRetry: (turn: TurnView) => {
                      send({ text: turn.prompt.text, spans: turn.prompt.spans });
                    },
                    onChangeModel: () => {
                      openModel();
                    },
                    onUpdateKey: (turn: TurnView) => {
                      openModel(turn.provider.kind === 'byok' ? 'byok' : undefined);
                    },
                    onEdit: (turn: TurnView) => {
                      if (!restorePrompt(conn, turn.prompt.text, turn.prompt.spans)) {
                        setNotice(
                          'The shared prompt already has text. Send it or clear it first, then press Edit again.',
                        );
                      }
                    },
                    onCompare: (turn: TurnView) => {
                      // a long draft does not matter here: the comparison sends an earlier prompt
                      const why = blocked?.startsWith('Too long') ? null : blocked;
                      if (why) {
                        setNotice(why);
                        return;
                      }
                      setComparing(turn);
                    },
                    isPinned: (turn: TurnView) => pinOf(session.doc, conn.id, turn.id) !== null,
                    onPin: (turn: TurnView) => {
                      const existing = pinOf(session.doc, conn.id, turn.id);
                      if (existing) {
                        removePin(session.doc, existing.id);
                        return;
                      }
                      const res = addPin(session.doc, {
                        sessionId: conn.id,
                        sessionName: current?.name ?? 'General',
                        turnId: turn.id,
                        label: ss.labels[turn.id] ?? '',
                        prompt: turn.prompt.text,
                        answer: turn.answer,
                        by: me.pid,
                        byName: me.name,
                        at: Date.now(),
                      });
                      setAccessNotice(
                        res === 'full'
                          ? 'A room keeps up to 50 pins. Unpin one first.'
                          : 'Pinned for the room: everyone in it can read this answer.',
                      );
                    },
                  }}
                />
              )}
            </div>
            <div
              className="sticky bottom-0 flex-none px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] max-md:px-2.5"
              style={{
                background: 'linear-gradient(to top, var(--c-bg) 72%, transparent)',
              }}
            >
              <Composer
                session={conn}
                people={ss.people}
                roster={snap.roster}
                me={me.pid}
                ready={ready}
                showAuthors={showAuthors}
                model={model}
                contextCount={
                  snap.context.filter((i) => i.included && !ss.roomContextOff.includes(i.id))
                    .length + ss.context.filter((i) => i.included).length
                }
                budget={context.budget}
                exact={context.exact}
                blocked={blocked}
                empty={
                  !context.stale &&
                  (context.assembled.segments.find((x) => x.kind === 'prompt')?.text.trim() ??
                    '') === ''
                }
                notice={notice}
                sendingMine={sendingMine}
                sendingOther={lockedByOther ? (ss.lock?.name ?? 'Someone') : null}
                streamingTurn={
                  streaming
                    ? { id: streaming.id, stopping: streaming.stopRequestedBy !== undefined }
                    : null
                }
                status={statusLine(snap, ss, demo !== undefined)}
                placeholder={
                  ss.path.length === 0
                    ? 'Write the prompt together…'
                    : 'Write the next prompt together…'
                }
                below={
                  <>
                    {fitNote ? (
                      <p className="px-2 pt-1.5 text-xs text-text-muted" data-testid="fit-note">
                        {fitNote}
                      </p>
                    ) : null}
                    <ModelNotice
                      model={model}
                      people={snap.people}
                      needsKey={needsKey}
                      onChange={() => {
                        openModel();
                      }}
                    />
                  </>
                }
                onSend={() => {
                  send();
                }}
                onStop={(id) => {
                  conn.stream.requestStop(id);
                }}
                onContext={() => {
                  setCtxTab('context');
                  setCtxOpen((o) => !o);
                }}
                onModel={() => {
                  openModel();
                }}
              />
            </div>
          </main>

          <aside
            aria-label="Context"
            className={cx(
              'z-[45] min-h-0 w-[400px] flex-none flex-col border-l border-border bg-surface',
              'max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:shadow-lg max-md:w-full',
              ctxOpen ? 'flex' : 'hidden',
            )}
            data-testid="context-panel"
          >
            <ContextPanel
              session={session}
              snap={snap}
              conn={conn}
              ss={ss}
              data={context}
              tab={ctxTab}
              onTab={setCtxTab}
              onClose={() => {
                setCtxOpen(false);
              }}
            />
          </aside>
        </div>
      </div>

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
          setRoomModel(conn.doc, { ...choice, setBy: me.pid });
          // sessions that never picked their own (and new ones) start with the latest choice
          setRoomModel(session.doc, { ...choice, setBy: me.pid });
          setNotice(null);
        }}
      />
      <ModelDialog
        open={comparing !== null}
        onOpenChange={(o) => {
          if (!o) setComparing(null);
        }}
        current={model}
        myName={me.name}
        title="Compare with another model"
        action="Send to this model"
        description="The same prompt, with the same context and history, goes to the model you pick. Both answers show side by side; the session's model does not change."
        onUse={(choice: RoomModelChoice) => {
          const turn = comparing;
          setComparing(null);
          if (!turn) return;
          if (choice.kind === 'webllm' && !isWebLlmReady(choice.model)) {
            setNotice('Start the in-browser model first, then compare again.');
            return;
          }
          void sendPrompt(
            conn,
            { text: turn.prompt.text, spans: turn.prompt.spans },
            (text) => tokensFor.current(text),
            undefined,
            { choice, compareOf: turn.id },
          ).then((r) => {
            if (!r.ok && (r.reason === 'lost' || r.reason === 'busy')) {
              setNotice(`${r.holder?.name ?? 'Someone else'} pressed Send first.`);
            }
          });
        }}
      />
      <AddKeyDialog
        open={addKeyOpen}
        onOpenChange={setAddKeyOpen}
        choice={model}
        myName={me.name}
        onSaved={() => {
          void sendPrompt(conn, pendingRetry, (text) => tokensFor.current(text));
        }}
        onUseDemo={() => {
          setRoomModel(conn.doc, { ...DEFAULT_MODEL, setBy: me.pid });
        }}
      />
      {exportUsed ? (
        <Suspense fallback={null}>
          <ExportDialog
            open={exportOpen}
            onOpenChange={setExportOpen}
            session={session}
            snap={snap}
            conn={conn}
            ss={ss}
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
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        sources={() =>
          snap.sessions
            .flatMap((s) => {
              const c = session.conn(s.id)?.getSnapshot();
              return c ? [{ id: s.id, name: s.name, turns: c.path, labels: c.labels }] : [];
            })
            .sort((a, b) => Number(b.id === conn.id) - Number(a.id === conn.id))
        }
        onPick={(hit) => {
          session.setActive(hit.sessionId);
          if (!matchesMedia('(min-width: 1100px)')) setSidebarOpen(false);
          // the session's thread draws on the next frames: then the turn is shown and marked
          let tries = 0;
          const find = () => {
            const el = document.querySelector<HTMLElement>(`[data-turn="${hit.turnId}"]`);
            if (!el) {
              if (tries++ < 30) requestAnimationFrame(find);
              return;
            }
            el.scrollIntoView({ block: 'center' });
            el.classList.add('pa-found');
            setTimeout(() => {
              el.classList.remove('pa-found');
            }, 2000);
          };
          requestAnimationFrame(find);
        }}
      />
      <PinDialog
        pin={openPin}
        onClose={() => {
          setOpenPin(null);
        }}
        canOpenSession={openPin !== null && snap.sessions.some((s) => s.id === openPin.sessionId)}
        canUnpin={openPin !== null && (openPin.by === me.pid || iAmHost)}
        onOpenSession={() => {
          if (openPin) session.setActive(openPin.sessionId);
          setOpenPin(null);
        }}
        onUnpin={() => {
          if (openPin) removePin(session.doc, openPin.id);
          setOpenPin(null);
        }}
      />
      <SessionDialog
        open={sessionDialog !== null}
        onOpenChange={(o) => {
          if (!o) setSessionDialog(null);
        }}
        editing={sessionDialog?.editing ?? null}
        candidates={candidates}
        onSave={async (name, members) => {
          const editing = sessionDialog?.editing;
          const res = editing
            ? await session.updateSession(editing.id, {
                ...(name !== editing.name ? { name } : {}),
                members,
              })
            : await session.createSession(name, members);
          if (!res.ok) return sessionProblem(res.reason);
          setAccessNotice(editing ? `${name} was saved.` : `${name} is ready.`);
          return null;
        }}
      />
      <DialogShell
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? 'this session'}?`}
        footer={
          <>
            <Button
              onClick={() => {
                setDeleting(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              data-testid="confirm-delete-session"
              onClick={() => {
                const what = deleting;
                setDeleting(null);
                if (!what) return;
                void session.deleteSession(what.id).then((res) => {
                  setAccessNotice(
                    res.ok ? `${what.name} was deleted.` : sessionProblem(res.reason),
                  );
                });
              }}
            >
              Delete session
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Its prompt, answers and files are deleted from the server for everyone in it. Export it
          first if you want to keep it. The room and its other sessions stay.
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
