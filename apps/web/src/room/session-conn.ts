import {
  RoomSync,
  StreamCoordinator,
  conversation,
  initSession,
  isSessionReady,
  listContext,
  listTurns,
  packState,
  readLock,
  readRoomModel,
  readSettings,
  readSystemLine,
  turnLabels,
  unpackState,
  type ContextItemView,
  type LockHolder,
  type SyncState,
  type Transport,
  type TurnView,
} from '@promptalong/core';
import { readModelChoice, type RoomModelChoice } from '@promptalong/providers';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { ActionResult } from '../backend/types';
import {
  readActivity,
  readUser,
  type Activity,
  type AwarenessUser,
  type PersonView,
} from './people';

export const SESSION_SAVE_QUIET_MS = 10_000;
export const SESSION_SAVE_MAX_WAIT_MS = 30_000;
/** what the database keeps for one saved copy (after compression) */
export const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_ORIGIN = 'snapshot';
const MIGRATE_ORIGIN = 'migrate';

export interface SessionSnapshot {
  state: SyncState;
  savedLocally: boolean;
  /** the people looking at this session now (this browser first only when it is the open one) */
  people: PersonView[];
  turns: TurnView[];
  /** the conversation, oldest first */
  path: TurnView[];
  labels: Record<string, string>;
  lock: LockHolder | null;
  /** this session's model (falls back to the room's) */
  model: RoomModelChoice;
  /** this session's own context items */
  context: ContextItemView[];
  /** this session's own instructions ('' = none) */
  systemLine: string;
  /** room items switched off for this session */
  roomContextOff: string[];
  /** turns started or answered since this person last looked */
  unread: number;
  /** an answer is streaming in this session now */
  streaming: boolean;
  /** the shared prompt exists (the editor starts only then, so it never adds a second one) */
  promptReady: boolean;
}

export interface LocalStore {
  whenSynced: Promise<unknown>;
  destroy(): unknown;
}

export interface SessionConnDeps {
  id: string;
  pid: string;
  transport: Transport;
  /** the room document: names, the room's context and its default model */
  room: Y.Doc;
  /** this person as shown to others (name, colour) */
  me: () => AwarenessUser;
  /** the room's people with a seat now (for the stream's "answering for N people") */
  persist?: (doc: Y.Doc) => LocalStore;
  /** the server copy; omitted for rooms without a server */
  server?: {
    load: () => Promise<Uint8Array | null>;
    save: (state: Uint8Array) => Promise<ActionResult>;
    /** the last copy while the page closes: sent at once, uncompressed (no time to wait) */
    saveOnLeave: (state: Uint8Array) => void;
    quietMs?: number;
    maxWaitMs?: number;
  };
  /** the room's first session also takes over a conversation saved in an older room copy */
  isDefault: boolean;
  /** this page prepares the session's prompt when it has none (the host's page) */
  preparer: () => boolean;
  now?: () => number;
  /** what this person is doing, for the room's people list */
  onActivity?: (activity: Activity) => void;
  stream?: { claimMs?: number; beatMs?: number; staleMs?: number; flushMs?: number };
  onChange: () => void;
}

/**
 * One session of a room: its own Yjs document (prompt, turns, Send lock, model, own context),
 * awareness for carets, live channel, local copy and saved copy on the server. A page keeps every
 * session it may open connected; only the one on screen shows this person's caret.
 */
export class SessionConn {
  readonly id: string;
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  readonly sync: RoomSync;
  readonly stream: StreamCoordinator;
  private readonly deps: SessionConnDeps;
  private store: LocalStore | null = null;
  private snapshot: SessionSnapshot;
  private visible = false;
  private activity: Activity = 'idle';
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private saveQuiet: ReturnType<typeof setTimeout> | null = null;
  private saveLatest: ReturnType<typeof setTimeout> | null = null;
  private unsaved = 0;
  private saving = false;
  private started = false;
  private stopped = false;
  /** how many turns (and finished answers) this person has seen */
  private seen = { turns: 0, done: 0 };
  private queued = false;

  constructor(deps: SessionConnDeps) {
    this.deps = deps;
    this.id = deps.id;
    this.awareness = new Awareness(this.doc);
    // not on screen yet: no caret, no name in this session until it is opened
    this.awareness.setLocalState(null);
    this.sync = new RoomSync(this.doc, this.awareness, deps.transport);
    this.stream = new StreamCoordinator(this.doc, {
      pid: deps.pid,
      session: this.sync.id,
      name: () => deps.me().name,
      peers: () => this.others().length,
      online: () => this.sync.state === 'synced' || this.sync.state === 'alone',
      room: () => deps.room,
      ...(deps.now ? { now: deps.now } : {}),
      ...deps.stream,
    });
    this.snapshot = {
      state: this.sync.state,
      savedLocally: !deps.persist,
      people: [],
      turns: [],
      path: [],
      labels: {},
      lock: null,
      model: readModelChoice(readRoomModel(deps.room)),
      context: [],
      systemLine: '',
      roomContextOff: [],
      unread: 0,
      streaming: false,
      promptReady: false,
    };
  }

  get pid(): string {
    return this.deps.pid;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.deps.persist) {
      this.store = this.deps.persist(this.doc);
      void this.store.whenSynced.then(() => {
        if (this.stopped) return;
        this.markSeenIfVisible();
        this.patch({ savedLocally: true });
        this.refresh();
      });
    }
    this.doc.on('update', this.onDocUpdate);
    this.doc.getMap('turns').observeDeep(this.onTurns);
    this.doc.getMap('lock').observe(this.onNow);
    this.doc.getMap('settings').observe(this.onNow);
    this.doc.getMap('context').observeDeep(this.onNow);
    this.doc.getMap('roomContextOff').observe(this.onNow);
    this.deps.room.getMap('settings').observe(this.onNow);
    this.deps.room.getMap('turns').observe(this.onRoomTurns);
    this.awareness.on('change', this.onAwareness);
    this.sync.onState(this.onSync);
    this.sync.connect();
    const server = this.deps.server;
    if (server) {
      void server.load().then(async (stored) => {
        if (this.stopped) return;
        if (stored) Y.applyUpdate(this.doc, await unpackState(stored), SNAPSHOT_ORIGIN);
        this.loaded = true;
        this.migrateOldRoom();
        this.ensurePrompt();
      });
    } else {
      this.loaded = true;
      this.migrateOldRoom();
      this.ensurePrompt();
    }
    this.refresh();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.typingTimer) clearTimeout(this.typingTimer);
    if (this.prepareTimer) clearTimeout(this.prepareTimer);
    if (this.saveQuiet) clearTimeout(this.saveQuiet);
    if (this.saveLatest) clearTimeout(this.saveLatest);
    this.doc.off('update', this.onDocUpdate);
    this.doc.getMap('turns').unobserveDeep(this.onTurns);
    this.doc.getMap('lock').unobserve(this.onNow);
    this.doc.getMap('settings').unobserve(this.onNow);
    this.doc.getMap('context').unobserveDeep(this.onNow);
    this.doc.getMap('roomContextOff').unobserve(this.onNow);
    this.deps.room.getMap('settings').unobserve(this.onNow);
    this.deps.room.getMap('turns').unobserve(this.onRoomTurns);
    this.awareness.off('change', this.onAwareness);
    // an answer this page is streaming is closed as "interrupted" and sent before sync stops
    this.stream.destroy();
    // last copy for the server: started now, before the page may be gone
    const server = this.deps.server;
    if (server && this.unsaved > 0 && this.isWriter()) {
      const state = Y.encodeStateAsUpdate(this.doc);
      if (state.length <= SNAPSHOT_MAX_BYTES) server.saveOnLeave(state);
    }
    this.sync.destroy();
    this.awareness.destroy();
    void this.store?.destroy();
    this.doc.destroy();
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;

  /** Opened on screen (caret and name shown here) or put in the background. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) {
      this.publishMe();
      this.markSeen();
    } else {
      this.setActivity('idle');
      this.awareness.setLocalState(null);
    }
    this.refresh();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** The name or colour changed: carets follow. */
  publishMe(): void {
    if (!this.visible || this.stopped) return;
    // (setLocalStateField does nothing while the state is null, as it is in the background)
    const state = this.awareness.getLocalState() ?? {};
    this.awareness.setLocalState({ ...state, user: this.deps.me(), activity: this.activity });
  }

  setActivity(activity: Activity): void {
    if (activity === 'typing') {
      if (this.typingTimer) clearTimeout(this.typingTimer);
      this.typingTimer = setTimeout(() => {
        this.typingTimer = null;
        this.setActivity('idle');
      }, 1500);
    } else if (this.typingTimer) {
      if (activity === 'idle') return; // still typing
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    if (activity === this.activity) return;
    this.activity = activity;
    this.deps.onActivity?.(activity);
    if (this.visible) this.awareness.setLocalStateField('activity', activity);
    this.refresh();
  }

  /** Everything here now counts as read. */
  markSeen(): void {
    const turns = listTurns(this.doc);
    this.seen = { turns: turns.length, done: turns.filter((t) => t.status !== 'streaming').length };
    this.patch({ unread: 0 });
  }

  private markSeenIfVisible(): void {
    if (this.visible) this.markSeen();
  }

  /**
   * A room saved before sessions existed kept its conversation in the room document. The room's
   * first session takes it over once: turns, the shared prompt and the model. Every page that does
   * this applies the same update, so doing it twice changes nothing.
   */
  private migrateOldRoom(): void {
    // only once this session's own copy is in: otherwise it could gain a second prompt
    if (!this.deps.isDefault || this.stopped || !this.loaded) return;
    const meta = this.doc.getMap<boolean>('meta');
    if (meta.get('migrated') === true) return;
    if (listTurns(this.doc).length > 0) return;
    if (listTurns(this.deps.room).length === 0) return;
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(this.deps.room));
    // only the conversation moves: room-wide things stay in the room document
    copy.transact(() => {
      for (const name of ['people', 'context', 'access', 'pins', 'sessions']) {
        const map = copy.getMap(name);
        for (const key of [...map.keys()]) map.delete(key);
      }
      // of the room's settings (name, host, instructions...) only the model moves along
      const settings = copy.getMap('settings');
      for (const key of [...settings.keys()]) if (key !== 'model') settings.delete(key);
      // this session already has its prompt: keep it, not a second one
      if (isSessionReady(this.doc)) {
        const prompt = copy.getXmlFragment('prompt');
        prompt.delete(0, prompt.length);
      }
    });
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(copy), MIGRATE_ORIGIN);
    copy.destroy();
    meta.set('migrated', true);
    this.markSeenIfVisible();
  }

  private readonly onRoomTurns = () => {
    this.migrateOldRoom();
  };

  private loaded = false;
  private prepareTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * A session's prompt must be written once, by one page. The host's page does it as soon as the
   * session is loaded; if the host is not here, the page that saves the session does it after a
   * short wait (time for a copy from someone else to arrive).
   */
  private ensurePrompt(): void {
    if (this.stopped || !this.loaded || isSessionReady(this.doc)) return;
    if (this.deps.preparer()) {
      initSession(this.doc, (this.deps.now ?? Date.now)());
      return;
    }
    this.prepareTimer ??= setTimeout(() => {
      this.prepareTimer = null;
      if (this.stopped || isSessionReady(this.doc)) return;
      if (this.isWriter() && this.sync.state !== 'connecting') {
        initSession(this.doc, (this.deps.now ?? Date.now)());
      } else {
        this.ensurePrompt();
      }
    }, 3000);
  }

  private readonly onDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (!this.snapshot.promptReady && isSessionReady(this.doc)) this.refresh();
    if (origin === SNAPSHOT_ORIGIN) return;
    this.unsaved += 1;
    this.scheduleSave();
  };

  /**
   * One person saves the session: the longest-present of those looking at it. When nobody looks
   * at it (an answer still streaming in after its sender switched away), any page that has it
   * open may save.
   */
  private isWriter(): boolean {
    const me = this.deps.me();
    const others = this.others();
    if (!this.visible) return others.length === 0;
    return others.every(
      (p) => me.joinedAt < p.joinedAt || (me.joinedAt === p.joinedAt && me.pid < p.pid),
    );
  }

  private scheduleSave(): void {
    const server = this.deps.server;
    if (!server || this.stopped || this.unsaved === 0 || !this.isWriter()) return;
    if (this.saveQuiet) clearTimeout(this.saveQuiet);
    this.saveQuiet = setTimeout(() => {
      void this.save();
    }, server.quietMs ?? SESSION_SAVE_QUIET_MS);
    this.saveLatest ??= setTimeout(() => {
      void this.save();
    }, server.maxWaitMs ?? SESSION_SAVE_MAX_WAIT_MS);
  }

  /** Saves now (also used when a session is created, so it exists on the server at once). */
  async save(force = false): Promise<ActionResult | null> {
    if (this.saveQuiet) clearTimeout(this.saveQuiet);
    if (this.saveLatest) clearTimeout(this.saveLatest);
    this.saveQuiet = this.saveLatest = null;
    const server = this.deps.server;
    if (!server || this.stopped || this.saving || this.unsaved === 0) return null;
    // a timer set while this page was alone; someone who has been here longer saves now
    if (!force && !this.isWriter()) return null;
    const upTo = this.unsaved;
    this.saving = true;
    const packed = await packState(Y.encodeStateAsUpdate(this.doc));
    const res = packed.length <= SNAPSHOT_MAX_BYTES ? await server.save(packed) : null;
    this.saving = false;
    if (res?.ok) this.unsaved -= upTo;
    if (this.unsaved > 0 && res !== null && (res.ok || res.reason === 'offline')) {
      this.scheduleSave();
    }
    return res;
  }

  private readonly onAwareness = () => {
    this.refresh();
    this.scheduleSave();
  };

  private readonly onSync = (state: SyncState) => {
    if (state === 'synced' || state === 'alone') this.stream.resetStaleClock();
    this.patch({ state });
    this.refresh();
  };

  private readonly onNow = () => {
    this.refresh();
  };

  /** Answers grow many times a second: refresh at most once per frame. */
  private readonly onTurns = () => {
    if (this.queued) return;
    this.queued = true;
    const run = () => {
      this.queued = false;
      if (this.visible) this.markSeen();
      this.refresh();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  };

  /** Everyone else looking at this session now, one entry per person. */
  others(): PersonView[] {
    const byPid = new Map<string, PersonView>();
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.awareness.clientID) return;
      const user = readUser(state.user);
      if (!user || user.pid === this.deps.pid) return;
      const activity = readActivity(state.activity);
      const view: PersonView = { ...user, me: false, activity, host: false };
      const existing = byPid.get(user.pid);
      if (!existing || user.joinedAt < existing.joinedAt) byPid.set(user.pid, view);
    });
    return [...byPid.values()];
  }

  refresh(): void {
    if (this.stopped) return;
    const lock = readLock(this.doc);
    const me = this.deps.me();
    const hostPid = readSettings(this.deps.room)?.hostPid ?? '';
    const people = [
      ...(this.visible ? [{ ...me, me: true, activity: this.activity, host: false }] : []),
      ...this.others(),
    ]
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.pid < b.pid ? -1 : 1))
      .map((p) => ({
        ...p,
        host: p.pid === hostPid,
        ...(lock?.pid === p.pid ? { activity: 'sending' as const } : {}),
      }));
    const turns = listTurns(this.doc);
    const done = turns.filter((t) => t.status !== 'streaming').length;
    const unread = this.visible
      ? 0
      : Math.max(0, turns.length - this.seen.turns) + Math.max(0, done - this.seen.done);
    const own = readRoomModel(this.doc);
    this.patch({
      state: this.sync.state,
      people,
      turns,
      path: conversation(this.doc),
      labels: Object.fromEntries(turnLabels(this.doc)),
      lock,
      model: readModelChoice(own ?? readRoomModel(this.deps.room)),
      context: listContext(this.doc),
      systemLine: readSystemLine(this.doc),
      roomContextOff: [...this.doc.getMap<boolean>('roomContextOff').keys()].sort(),
      unread,
      streaming: turns.some((t) => t.status === 'streaming'),
      promptReady: isSessionReady(this.doc),
    });
  }

  private patch(change: Partial<SessionSnapshot>): void {
    const next = { ...this.snapshot, ...change };
    const changed = (Object.keys(change) as (keyof SessionSnapshot)[]).some(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(this.snapshot[k]),
    );
    if (!changed) return;
    this.snapshot = next;
    this.deps.onChange();
  }
}
