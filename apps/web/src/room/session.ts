import {
  RoomSync,
  chooseSlot,
  initRoom,
  isMarkedDeleted,
  isMarkedRemoved,
  isOverCapacity,
  listContext,
  listPins,
  lockedBy,
  markDeleted,
  markRemoved,
  packState,
  peopleMap,
  readLocked,
  readRoomModel,
  readSettings,
  readSystemLine,
  removedPeople,
  unpackState,
  upsertPerson,
  writeHost,
  writeLocked,
  type ContextItemView,
  type PinView,
  type PresentPerson,
  type RoomSettings,
  type SendPolicy,
  type SyncState,
  type Transport,
} from '@promptalong/core';
import { readModelChoice, type RoomModelChoice } from '@promptalong/providers';
import { presenceHex } from '@promptalong/ui';
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { LocalOnlyTransport } from '../realtime/local-transport';
import type {
  ActionResult,
  RoomBackend,
  RoomInfo,
  SessionInfo,
  SessionResult,
} from '../backend/types';
import {
  readActivity,
  readUser,
  type Activity,
  type AwarenessUser,
  type PersonView,
} from './people';
import {
  SNAPSHOT_MAX_BYTES,
  SessionConn,
  type LocalStore,
  type SessionSnapshot,
} from './session-conn';

export { readUser, SNAPSHOT_MAX_BYTES };
export type { Activity, AwarenessUser, LocalStore, PersonView, SessionSnapshot };

/** A session as the room shows it: name, members and what is new in it for this person. */
export interface SessionView {
  id: string;
  name: string;
  isDefault: boolean;
  members: string[];
  /** turns started or answered since this person last looked */
  unread: number;
  streaming: boolean;
  /** people who have it open now */
  viewers: string[];
}

export interface RoomSnapshot {
  state: SyncState;
  savedLocally: boolean;
  settings: RoomSettings | null;
  /** everyone in the room now, with the session each has open */
  people: PersonView[];
  me: AwarenessUser;
  full: boolean;
  /** everyone who ever wrote here (people of this room, also those who left) */
  roster: Record<string, RosterEntry>;
  /** the room's context items (every session gets them unless it switches one off) */
  context: ContextItemView[];
  /** the room's instructions, sent before everything else ('' = none) */
  systemLine: string;
  /** the room's default model (new sessions start with it) */
  model: RoomModelChoice;
  /** new people cannot join (people who already have a seat can come back) */
  locked: boolean;
  lockedBy: string | null;
  /** the room has a server: it can be locked, people can be removed, it is saved for later */
  managed: boolean;
  /** set when this person is out: removed by the host, or the room was deleted */
  ended: 'removed' | 'deleted' | null;
  /** the sessions this person may open (the host: all of them) */
  sessions: SessionView[];
  /** false until the session list has arrived */
  sessionsLoaded: boolean;
  /** the session on screen (null = none: this person is in no session) */
  activeId: string | null;
  /** answers kept for the whole room, newest first */
  pins: PinView[];
}

export interface RosterEntry {
  name: string;
  slot: number;
}

export interface CreateOptions {
  name: string;
  sendPolicy: SendPolicy;
}

/** The room on the server, as create_room / join_room answered. */
export interface RoomAccess {
  backend: RoomBackend;
  room: RoomInfo;
  /** the colour slot the server gave this person (0 = none) */
  slot: number;
  /** timings (tests make them short) */
  heartbeatMs?: number;
  saveQuietMs?: number;
  saveMaxWaitMs?: number;
}

export const HEARTBEAT_MS = 30_000;
export const SAVE_QUIET_MS = 10_000;
export const SAVE_MAX_WAIT_MS = 30_000;
/** the one session of a room that has no server (the demo, rooms on this device only) */
export const LOCAL_SESSION_ID = 'general';
const SNAPSHOT_ORIGIN = 'snapshot';

export interface RoomSessionDeps {
  code: string;
  pid: string;
  name: string;
  transport: Transport;
  /** live channel of a session in a room without a server (the demo's in-page channel) */
  sessionTransport?: (sessionId: string) => Transport;
  /** the server side of the room; omitted for rooms that live on this device only */
  access?: RoomAccess;
  /** local persistence (y-indexeddb in the app; omitted in tests); `key` names the document */
  persist?: (doc: Y.Doc, key: string) => LocalStore;
  create?: CreateOptions;
  /**
   * Where this person sits in join order and which colour they ask for. The live demo shows the
   * visitor's room first and lets the scripted teammates join a moment later.
   */
  joinedAt?: number;
  slot?: number;
  now?: () => number;
  /** shared-stream timings (tests make them short) */
  stream?: { claimMs?: number; beatMs?: number; staleMs?: number; flushMs?: number };
  /**
   * This page writes the shared prompt of a session that has none (default: in rooms without a
   * server; the demo's scripted teammates say no, the visitor's page does it).
   */
  prepare?: boolean;
  /** where to remember the open session between visits (sessionStorage in the app) */
  remember?: { get(key: string): string | null; set(key: string, value: string): void };
}

/**
 * One open room: the room document (people, room context, instructions, settings) with its
 * awareness and sync, the server seat, and one SessionConn per session this person may open. React
 * reads it through subscribe/getSnapshot (useSyncExternalStore).
 */
export class RoomSession {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  readonly sync: RoomSync;
  readonly code: string;
  private readonly deps: RoomSessionDeps;
  private store: LocalStore | null = null;
  private snapshot: RoomSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly conns = new Map<string, SessionConn>();
  private infos: SessionInfo[] = [];
  private started = false;
  private stopped = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private saveQuiet: ReturnType<typeof setTimeout> | null = null;
  private saveLatest: ReturnType<typeof setTimeout> | null = null;
  private unsaved = 0;
  private saving = false;
  private lastBeat = 0;
  private beatLater: ReturnType<typeof setTimeout> | null = null;
  private readonly dropped = new Set<string>();
  private sessionsRev = -1;
  private listing: Promise<void> | null = null;
  private relist = false;
  private lastSending = '';
  /** sessions this page created: their prompt is prepared here */
  private readonly madeHere = new Set<string>();

  constructor(deps: RoomSessionDeps) {
    this.deps = deps;
    this.code = deps.code;
    this.awareness = new Awareness(this.doc);
    this.sync = new RoomSync(this.doc, this.awareness, deps.transport);
    const now = deps.now ?? Date.now;
    const remembered = peopleMap(this.doc).get(deps.pid);
    const given = deps.access?.slot ?? deps.slot ?? 0;
    const slot = given > 0 ? given : (remembered?.slot ?? 0);
    const me: AwarenessUser = {
      pid: deps.pid,
      name: deps.name,
      slot,
      joinedAt: deps.joinedAt ?? now(),
      ...presenceHex(slot || 1),
    };
    this.snapshot = {
      state: this.sync.state,
      savedLocally: !deps.persist,
      settings: null,
      people: [],
      me,
      full: false,
      roster: {},
      context: [],
      systemLine: '',
      model: readModelChoice(undefined),
      locked: deps.access?.room.locked ?? false,
      lockedBy: null,
      managed: deps.access?.backend.server === true,
      ended: null,
      sessions: [],
      sessionsLoaded: false,
      activeId: null,
      pins: [],
    };
  }

  private get managed(): RoomAccess | null {
    return this.deps.access?.backend.server ? this.deps.access : null;
  }

  /** this browser's participant id (the author id on text written here) */
  get pid(): string {
    return this.deps.pid;
  }

  /** the session on screen */
  get active(): SessionConn | null {
    const id = this.snapshot.activeId;
    return id ? (this.conns.get(id) ?? null) : null;
  }

  /** Resolves once the session list has been fetched (and again after each change). */
  sessionsReady(): Promise<void> {
    return this.listing ?? Promise.resolve();
  }

  /** an open session by id (every session this person may open is kept connected) */
  conn(id: string): SessionConn | null {
    return this.conns.get(id) ?? null;
  }

  /** every connected session, in list order */
  allConns(): SessionConn[] {
    return this.snapshot.sessions
      .map((s) => this.conns.get(s.id))
      .filter((c): c is SessionConn => c !== undefined);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const create = this.deps.create;
    if (this.deps.persist) {
      this.store = this.deps.persist(this.doc, `promptalong:room:${this.code}`);
      void this.store.whenSynced.then(() => {
        if (this.stopped) return;
        if (create) this.createRoom(create);
        this.reconcileSlot();
        this.update({ savedLocally: true });
      });
    } else if (create) {
      this.createRoom(create);
    }
    this.awareness.setLocalStateField('activity', 'idle');
    this.reconcileSlot();
    this.awareness.on('change', this.onAwareness);
    this.doc.getMap('settings').observe(this.onSettings);
    this.doc.getMap('people').observe(this.onSettings);
    this.doc.getMap('context').observeDeep(this.onSettings);
    this.doc.getMap('access').observe(this.onAccess);
    this.doc.getMap('sessions').observe(this.onSessionsSignal);
    this.doc.getMap('pins').observeDeep(this.onSettings);
    this.sync.onState(this.onSyncState);
    this.sync.connect();
    this.startServerSide(create !== undefined);
    void this.loadSessions();
    this.refresh();
  }

  private startServerSide(created: boolean): void {
    const access = this.managed;
    if (!access) return;
    this.doc.on('update', this.onDocUpdate);
    void this.beat();
    this.heartbeat = setInterval(() => {
      void this.beat();
    }, access.heartbeatMs ?? HEARTBEAT_MS);
    if (created) {
      this.unsaved += 1;
      void Promise.resolve(this.store?.whenSynced).then(() => this.save());
    } else {
      void access.backend.loadSnapshot(access.room.id).then(async (stored) => {
        if (stored && !this.stopped) {
          Y.applyUpdate(this.doc, await unpackState(stored), SNAPSHOT_ORIGIN);
        }
      });
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.awareness.off('change', this.onAwareness);
    this.doc.getMap('settings').unobserve(this.onSettings);
    this.doc.getMap('people').unobserve(this.onSettings);
    this.doc.getMap('context').unobserveDeep(this.onSettings);
    this.doc.getMap('access').unobserve(this.onAccess);
    this.doc.getMap('sessions').unobserve(this.onSessionsSignal);
    this.doc.getMap('pins').unobserveDeep(this.onSettings);
    this.doc.off('update', this.onDocUpdate);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.beatLater) clearTimeout(this.beatLater);
    if (this.saveQuiet) clearTimeout(this.saveQuiet);
    if (this.saveLatest) clearTimeout(this.saveLatest);
    for (const c of this.conns.values()) c.stop();
    this.conns.clear();
    const access = this.managed;
    if (access && !this.snapshot.ended) {
      // the room copy goes with the request that gives the seat back (one request is certain)
      const state =
        this.unsaved > 0 && this.isWriter() ? Y.encodeStateAsUpdate(this.doc) : undefined;
      access.backend.leave(
        access.room.id,
        state && state.length <= SNAPSHOT_MAX_BYTES ? state : undefined,
      );
    }
    this.sync.destroy();
    this.awareness.destroy();
    void this.store?.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RoomSnapshot => this.snapshot;

  /** The editor reports what this person is doing (people list, strands). */
  setActivity(activity: Activity): void {
    this.active?.setActivity(activity);
  }

  rename(name: string): void {
    this.publishMe({ ...this.snapshot.me, name });
  }

  // -------------------------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------------------------

  /** Opens a session on screen; the others stay connected in the background. */
  setActive(id: string): void {
    if (!this.conns.has(id) || this.snapshot.activeId === id) return;
    for (const [cid, c] of this.conns) c.setVisible(cid === id);
    this.deps.remember?.set(`promptalong:active:${this.code}`, id);
    this.awareness.setLocalStateField('viewing', id);
    this.update({ activeId: id });
    this.refreshSessions();
  }

  /** Host: a new session with these people (1-8, each with a seat). Opens it here. */
  async createSession(name: string, members: string[]): Promise<SessionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.createSession(access.room.id, name, members);
    if (!res.ok || this.stopped) return res;
    this.madeHere.add(res.session.id);
    this.signalSessions();
    await this.loadSessions();
    const conn = this.conns.get(res.session.id);
    if (conn) {
      void conn.save(true);
      this.setActive(res.session.id);
    }
    return res;
  }

  /** Host: rename a session or replace its members. */
  async updateSession(
    id: string,
    patch: { name?: string; members?: string[] },
  ): Promise<SessionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.updateSession(id, patch);
    if (res.ok && !this.stopped) {
      this.signalSessions();
      await this.loadSessions();
    }
    return res;
  }

  /** Host: delete a session (not the room's first one). */
  async deleteSession(id: string): Promise<ActionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.deleteSession(id);
    if (res.ok && !this.stopped) {
      this.signalSessions();
      await this.loadSessions();
    }
    return res;
  }

  /** Tells every open page at once that the session list changed (the server is the judge). */
  private signalSessions(): void {
    const map = this.doc.getMap<number>('sessions');
    map.set('rev', (map.get('rev') ?? 0) + 1);
  }

  private readonly onSessionsSignal = (_e: Y.YMapEvent<unknown>, tr: Y.Transaction) => {
    if (!tr.local) void this.loadSessions();
  };

  /** Fetches the session list (one request at a time; a change meanwhile asks again). */
  private loadSessions(): Promise<void> {
    if (this.listing) {
      this.relist = true;
      return this.listing;
    }
    this.listing = this.fetchSessions().finally(() => {
      this.listing = null;
      if (this.relist && !this.stopped) {
        this.relist = false;
        void this.loadSessions();
      }
    });
    return this.listing;
  }

  private async fetchSessions(): Promise<void> {
    const access = this.managed;
    let infos: SessionInfo[];
    if (access) {
      const res = await access.backend.listSessions(access.room.id);
      if (this.stopped || !res.ok) return;
      this.sessionsRev = res.rev;
      infos = res.sessions;
    } else {
      infos = [
        {
          id: LOCAL_SESSION_ID,
          roomId: this.code,
          name: 'General',
          isDefault: true,
          members: [this.deps.pid],
          createdAt: '',
        },
      ];
    }
    this.infos = infos;
    this.applySessions();
  }

  /** Opens connections for new sessions, closes the ones this person lost. */
  private applySessions(): void {
    const ids = new Set(this.infos.map((s) => s.id));
    for (const [id, c] of this.conns) {
      if (!ids.has(id)) {
        c.stop();
        this.conns.delete(id);
      }
    }
    for (const info of this.infos) {
      if (!this.conns.has(info.id)) this.conns.set(info.id, this.openConn(info));
    }
    let active = this.snapshot.activeId;
    if (!active || !ids.has(active)) {
      const remembered = this.deps.remember?.get(`promptalong:active:${this.code}`) ?? null;
      const mine = (s: SessionInfo) => s.members.includes(this.deps.pid);
      active =
        (remembered && ids.has(remembered) ? remembered : null) ??
        this.infos.find((s) => s.isDefault && mine(s))?.id ??
        this.infos.find(mine)?.id ??
        this.infos[0]?.id ??
        null;
    }
    if (active) {
      for (const [cid, c] of this.conns) c.setVisible(cid === active);
      this.awareness.setLocalStateField('viewing', active);
    }
    this.update({ activeId: active, sessionsLoaded: true });
    this.refreshSessions();
  }

  private openConn(info: SessionInfo): SessionConn {
    const access = this.managed;
    const persist = this.deps.persist;
    const transport = access
      ? access.backend.sessionTransport(access.room, info.id)
      : (this.deps.sessionTransport?.(info.id) ?? new LocalOnlyTransport());
    const conn: SessionConn = new SessionConn({
      id: info.id,
      pid: this.deps.pid,
      transport,
      room: this.doc,
      me: () => this.snapshot.me,
      isDefault: info.isDefault,
      // the page that made the session prepares its prompt; otherwise the host's page
      preparer: () =>
        this.madeHere.has(info.id) ||
        readSettings(this.doc)?.hostPid === this.deps.pid ||
        (!access && (this.deps.prepare ?? true)),
      ...(persist
        ? { persist: (doc: Y.Doc) => persist(doc, `promptalong:session:${this.code}:${info.id}`) }
        : {}),
      ...(access
        ? {
            server: {
              load: () => access.backend.loadSessionSnapshot(info.id),
              save: (state: Uint8Array) => access.backend.saveSessionSnapshot(info.id, state),
              saveOnLeave: (state: Uint8Array) => {
                access.backend.saveSessionOnLeave(info.id, state);
              },
              ...(access.saveQuietMs !== undefined ? { quietMs: access.saveQuietMs } : {}),
              ...(access.saveMaxWaitMs !== undefined ? { maxWaitMs: access.saveMaxWaitMs } : {}),
            },
          }
        : {}),
      ...(this.deps.now ? { now: this.deps.now } : {}),
      ...(this.deps.stream ? { stream: this.deps.stream } : {}),
      onActivity: (activity) => {
        if (this.stopped || !conn.isVisible) return;
        this.awareness.setLocalStateField('activity', activity === 'sending' ? 'idle' : activity);
        this.refresh();
      },
      onChange: () => {
        // someone started or finished sending: the room's people list shows it
        const sending = this.sendingPids().join(',');
        if (sending !== this.lastSending) {
          this.lastSending = sending;
          this.refresh();
        }
        this.refreshSessions();
        for (const l of this.listeners) l();
      },
    });
    conn.start();
    return conn;
  }

  /** The session list with what is new in each. */
  private refreshSessions(): void {
    if (this.stopped) return;
    const viewing = new Map<string, string[]>();
    this.awareness.getStates().forEach((state) => {
      const user = readUser(state.user);
      const v = typeof state.viewing === 'string' ? state.viewing : null;
      if (!user || !v) return;
      viewing.set(v, [...(viewing.get(v) ?? []), user.pid]);
    });
    const sessions: SessionView[] = this.infos.map((info) => {
      const s = this.conns.get(info.id)?.getSnapshot();
      return {
        id: info.id,
        name: info.name,
        isDefault: info.isDefault,
        members: info.members,
        unread: s?.unread ?? 0,
        streaming: s?.streaming ?? false,
        viewers: [...new Set(viewing.get(info.id) ?? [])],
      };
    });
    this.update({ sessions });
  }

  // -------------------------------------------------------------------------------------------
  // Host powers
  // -------------------------------------------------------------------------------------------

  async setLocked(locked: boolean): Promise<ActionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.setLocked(access.room.id, locked);
    if (res.ok && !this.stopped) writeLocked(this.doc, locked, this.deps.pid);
    return res;
  }

  async removePerson(pid: string): Promise<ActionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.removeMember(access.room.id, pid);
    if (res.ok && !this.stopped) {
      markRemoved(this.doc, pid);
      this.signalSessions();
      void this.loadSessions();
    }
    return res;
  }

  async makeHost(pid: string): Promise<ActionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.transferHost(access.room.id, pid);
    if (res.ok && !this.stopped) {
      writeHost(this.doc, pid);
      this.signalSessions(); // the new host sees every session, the old one only their own
      void this.loadSessions();
    }
    return res;
  }

  async deleteRoom(): Promise<ActionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.deleteRoom(access.room.id);
    if (res.ok && !this.stopped) {
      markDeleted(this.doc);
      this.end('deleted');
    }
    return res;
  }

  // -------------------------------------------------------------------------------------------
  // The room copy on the server and the heartbeat
  // -------------------------------------------------------------------------------------------

  private readonly onDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === SNAPSHOT_ORIGIN) return;
    this.unsaved += 1;
    this.scheduleSave();
  };

  private isWriter(): boolean {
    const me = this.snapshot.me;
    return this.others().every(
      (p) => me.joinedAt < p.joinedAt || (me.joinedAt === p.joinedAt && me.pid < p.pid),
    );
  }

  private scheduleSave(): void {
    const access = this.managed;
    if (!access || this.stopped || this.unsaved === 0 || !this.isWriter()) return;
    if (this.saveQuiet) clearTimeout(this.saveQuiet);
    this.saveQuiet = setTimeout(() => {
      void this.save();
    }, access.saveQuietMs ?? SAVE_QUIET_MS);
    this.saveLatest ??= setTimeout(() => {
      void this.save();
    }, access.saveMaxWaitMs ?? SAVE_MAX_WAIT_MS);
  }

  private async save(): Promise<void> {
    if (this.saveQuiet) clearTimeout(this.saveQuiet);
    if (this.saveLatest) clearTimeout(this.saveLatest);
    this.saveQuiet = this.saveLatest = null;
    const access = this.managed;
    if (!access || this.stopped || this.saving || this.unsaved === 0 || !this.isWriter()) return;
    const upTo = this.unsaved;
    this.saving = true;
    const packed = await packState(Y.encodeStateAsUpdate(this.doc));
    const res =
      packed.length <= SNAPSHOT_MAX_BYTES && !this.isStopped()
        ? await access.backend.saveSnapshot(access.room.id, packed)
        : null;
    this.saving = false;
    if (res?.ok) this.unsaved -= upTo;
    if (this.unsaved > 0 && res !== null && (res.ok || res.reason === 'offline')) {
      this.scheduleSave();
    }
  }

  private async beat(): Promise<void> {
    const access = this.managed;
    if (!access || this.stopped || this.snapshot.ended) return;
    const now = Date.now();
    const wait = this.lastBeat + 1000 - now;
    if (wait > 0) {
      this.beatLater ??= setTimeout(() => {
        this.beatLater = null;
        void this.beat();
      }, wait);
      return;
    }
    this.lastBeat = now;
    const res = await access.backend.touch(access.room.id);
    if (this.isStopped()) return;
    if (!res.ok) {
      if (res.reason === 'removed') this.end('removed');
      else if (res.reason === 'not-member') this.end('deleted');
      return;
    }
    if (res.room.sessionsRev !== this.sessionsRev && this.sessionsRev !== -1) {
      void this.loadSessions();
    }
    if (res.room.hostUid === this.deps.pid && readSettings(this.doc)) {
      writeHost(this.doc, this.deps.pid);
      writeLocked(this.doc, res.room.locked, lockedBy(this.doc) ?? this.deps.pid);
    }
  }

  private isStopped(): boolean {
    return this.stopped;
  }

  private end(reason: 'removed' | 'deleted'): void {
    if (this.snapshot.ended) return;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.beatLater) clearTimeout(this.beatLater);
    this.heartbeat = this.beatLater = null;
    this.update({ ended: reason });
    this.sync.destroy();
    for (const c of this.conns.values()) c.sync.destroy();
  }

  private readonly onAccess = () => {
    for (const pid of removedPeople(this.doc)) {
      if (this.dropped.has(pid) || pid === this.deps.pid) continue;
      this.dropped.add(pid);
      const clients: number[] = [];
      this.awareness.getStates().forEach((state, clientId) => {
        if (readUser(state.user)?.pid === pid) clients.push(clientId);
      });
      if (clients.length > 0) removeAwarenessStates(this.awareness, clients, 'removed');
    }
    this.refresh();
    if (isMarkedRemoved(this.doc, this.deps.pid) || isMarkedDeleted(this.doc)) void this.beat();
  };

  private createRoom(create: CreateOptions): void {
    initRoom(this.doc, {
      name: create.name,
      sendPolicy: create.sendPolicy,
      hostPid: this.deps.pid,
      createdAt: (this.deps.now ?? Date.now)(),
    });
  }

  private readonly onAwareness = () => {
    this.reconcileSlot();
    this.refresh();
    this.refreshSessions();
    this.scheduleSave();
  };

  private readonly onSettings = () => {
    this.refresh();
    for (const c of this.conns.values()) c.refresh();
  };

  private readonly onSyncState = (state: SyncState) => {
    if (state === 'connecting' && this.started) void this.beat();
    this.reconcileSlot();
    this.refresh();
    if (state === 'offline') this.update({ state });
  };

  private others(): PersonView[] {
    const byPid = new Map<string, PersonView>();
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.awareness.clientID) return;
      const user = readUser(state.user);
      if (!user || user.pid === this.deps.pid) return;
      const view: PersonView = {
        ...user,
        me: false,
        activity: readActivity(state.activity),
        host: false,
        viewing: typeof state.viewing === 'string' ? state.viewing.slice(0, 64) : null,
      };
      const existing = byPid.get(user.pid);
      if (!existing || user.joinedAt < existing.joinedAt) byPid.set(user.pid, view);
    });
    return [...byPid.values()];
  }

  private reconcileSlot(): void {
    if (this.stopped) return;
    const me = this.snapshot.me;
    const others: PresentPerson[] = this.others();
    const remembered = peopleMap(this.doc).get(this.deps.pid)?.slot ?? 0;
    const slot = chooseSlot(
      { pid: me.pid, slot: me.slot || remembered, joinedAt: me.joinedAt },
      others,
    );
    if (slot !== me.slot || !this.awareness.getLocalState()?.user) {
      this.publishMe({ ...me, slot, ...presenceHex(slot) });
    }
  }

  private publishMe(me: AwarenessUser): void {
    this.snapshot = { ...this.snapshot, me };
    this.awareness.setLocalStateField('user', me);
    const record = peopleMap(this.doc).get(me.pid);
    upsertPerson(this.doc, me.pid, {
      name: me.name,
      slot: me.slot,
      joinedAt: record?.joinedAt ?? me.joinedAt,
    });
    for (const c of this.conns.values()) c.publishMe();
  }

  private refresh(): void {
    if (this.stopped) return;
    const settings = readSettings(this.doc);
    const me = this.snapshot.me;
    const others = this.others();
    const state = this.sync.state;
    const full =
      this.snapshot.full ||
      (state !== 'connecting' && state !== 'offline' && isOverCapacity(me, others));
    const sending = new Set(this.sendingPids());
    const people: PersonView[] = [
      {
        ...me,
        me: true,
        activity: readActivity(this.awareness.getLocalState()?.activity),
        host: false,
        viewing: this.snapshot.activeId,
      },
      ...others,
    ]
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.pid < b.pid ? -1 : 1))
      .map((p) => ({
        ...p,
        host: settings?.hostPid === p.pid,
        ...(sending.has(p.pid) ? { activity: 'sending' as const } : {}),
      }));
    const wasFull = this.snapshot.full;
    const roster: Record<string, RosterEntry> = {};
    peopleMap(this.doc).forEach((rec, pid) => {
      if (typeof rec === 'object' && typeof rec.name === 'string' && typeof rec.slot === 'number') {
        roster[pid] = { name: rec.name, slot: rec.slot };
      }
    });
    for (const p of people) roster[p.pid] = { name: p.name, slot: p.slot };
    this.update({
      state,
      settings,
      people,
      full,
      roster,
      context: listContext(this.doc),
      systemLine: readSystemLine(this.doc),
      model: readModelChoice(readRoomModel(this.doc)),
      locked: this.managed ? readLocked(this.doc) || this.initiallyLocked() : false,
      lockedBy: lockedBy(this.doc),
      pins: listPins(this.doc),
    });
    if (full && !wasFull) this.leaveBecauseFull();
  }

  /** who is sending in any session now */
  private sendingPids(): string[] {
    const pids: string[] = [];
    for (const c of this.conns.values()) {
      const pid = c.getSnapshot().lock?.pid;
      if (pid) pids.push(pid);
    }
    return pids.sort();
  }

  private initiallyLocked(): boolean {
    return this.deps.access?.room.locked === true && lockedBy(this.doc) === null;
  }

  private leaveBecauseFull(): void {
    if (this.stopped) return;
    this.sync.destroy();
    for (const c of this.conns.values()) c.sync.destroy();
  }

  private update(patch: Partial<RoomSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    const changed = (Object.keys(patch) as (keyof RoomSnapshot)[]).some(
      (k) => !shallowEqual(next[k], this.snapshot[k]),
    );
    if (!changed) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export type { SessionInfo };
