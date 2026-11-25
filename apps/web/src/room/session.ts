import {
  MAIN_BRANCH,
  RoomSync,
  StreamCoordinator,
  activeBranch,
  activeBranchBy,
  applyFork,
  chooseSlot,
  listBranches,
  listContext,
  listMergeEvents,
  listTurns,
  readAuthors,
  turnLabels,
  turnsOnPath,
  type BranchView,
  type ContextItemView,
  type ForkPayload,
  type MergeEvent,
  readLock,
  readRoomModel,
  initRoom,
  isMarkedDeleted,
  isMarkedRemoved,
  isOverCapacity,
  lockedBy,
  markDeleted,
  markRemoved,
  readLocked,
  writeHost,
  writeLocked,
  peopleMap,
  readSettings,
  readSystemLine,
  removedPeople,
  upsertPerson,
  type PresentPerson,
  type RoomSettings,
  type SendPolicy,
  type LockHolder,
  type SyncState,
  type Transport,
  type TurnView,
} from '@promptalong/core';
import { readModelChoice, type RoomModelChoice } from '@promptalong/providers';
import { presenceHex } from '@promptalong/ui';
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { ActionResult, RoomBackend, RoomInfo } from '../backend/types';

export type Activity = 'typing' | 'selecting' | 'idle' | 'sending';

/** What each person publishes about themselves (awareness field "user"). */
export interface AwarenessUser {
  pid: string;
  name: string;
  slot: number;
  /** when this visit started (slot priority) */
  joinedAt: number;
  /** hex colour, read by the editor carets */
  color: string;
  /** hex colour for text drawn on `color` */
  label: string;
}

export interface PersonView extends AwarenessUser {
  me: boolean;
  activity: Activity;
  host: boolean;
}

export interface RoomSnapshot {
  state: SyncState;
  savedLocally: boolean;
  settings: RoomSettings | null;
  people: PersonView[];
  me: AwarenessUser;
  full: boolean;
  turns: TurnView[];
  /** who holds Send (null = free) */
  lock: LockHolder | null;
  model: RoomModelChoice;
  branches: BranchView[];
  /** the branch the shared editor shows */
  activeBranch: string;
  /** who last switched the room's branch */
  activeBranchBy: string | null;
  /** the active branch's history, oldest first */
  path: TurnView[];
  /** short turn labels: T1, T2, T3b… */
  labels: Record<string, string>;
  /** everyone who ever wrote here: people of this room + frozen authors of a forked room */
  roster: Record<string, RosterEntry>;
  merges: MergeEvent[];
  /** the room's context items, in creation order (their text stays in the document) */
  context: ContextItemView[];
  /** the room line sent before everything else ('' = none) */
  systemLine: string;
  /** new people cannot join (people who already have a seat can come back) */
  locked: boolean;
  /** who locked or unlocked it last */
  lockedBy: string | null;
  /** the room has a server: it can be locked, people can be removed, it is saved for later */
  managed: boolean;
  /** set when this person is out: removed by the host, or the room was deleted */
  ended: 'removed' | 'deleted' | null;
}

export interface RosterEntry {
  name: string;
  slot: number;
  /** set for authors copied from another room by a fork */
  from?: string;
}

export interface CreateOptions {
  name: string;
  sendPolicy: SendPolicy;
  /** the turns and authors copied from another room (Fork room) */
  fork?: ForkPayload;
}

export interface LocalStore {
  whenSynced: Promise<unknown>;
  destroy(): unknown;
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
/** A room document larger than this is not sent to the server (the database refuses it). */
export const SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_ORIGIN = 'snapshot';

export interface RoomSessionDeps {
  code: string;
  pid: string;
  name: string;
  transport: Transport;
  /** the server side of the room; omitted for rooms that live on this device only */
  access?: RoomAccess;
  /** local persistence (y-indexeddb in the app; omitted in tests) */
  persist?: (doc: Y.Doc) => LocalStore;
  create?: CreateOptions;
  now?: () => number;
  /** shared-stream timings (tests make them short) */
  stream?: { claimMs?: number; beatMs?: number; staleMs?: number; flushMs?: number };
}

/**
 * One open room: the Yjs document, awareness, local persistence and sync. React reads it through
 * subscribe/getSnapshot (useSyncExternalStore).
 */
export class RoomSession {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  readonly sync: RoomSync;
  readonly stream: StreamCoordinator;
  readonly code: string;
  private readonly deps: RoomSessionDeps;
  private store: LocalStore | null = null;
  private snapshot: RoomSnapshot;
  private readonly listeners = new Set<() => void>();
  private started = false;
  private stopped = false;
  private activity: Activity = 'idle';
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private saveQuiet: ReturnType<typeof setTimeout> | null = null;
  private saveLatest: ReturnType<typeof setTimeout> | null = null;
  /** changes since the last snapshot the server accepted */
  private unsaved = 0;
  private saving = false;
  private lastBeat = 0;
  /** removed people already taken out of the people list */
  private readonly dropped = new Set<string>();

  constructor(deps: RoomSessionDeps) {
    this.deps = deps;
    this.code = deps.code;
    this.awareness = new Awareness(this.doc);
    this.sync = new RoomSync(this.doc, this.awareness, deps.transport);
    this.stream = new StreamCoordinator(this.doc, {
      pid: deps.pid,
      session: this.sync.id,
      name: () => this.snapshot.me.name,
      peers: () => this.others().length,
      online: () => this.sync.state === 'synced' || this.sync.state === 'alone',
      ...(deps.now ? { now: deps.now } : {}),
      ...deps.stream,
    });
    const now = deps.now ?? Date.now;
    const remembered = peopleMap(this.doc).get(deps.pid);
    const given = deps.access?.slot ?? 0;
    const slot = given > 0 ? given : (remembered?.slot ?? 0);
    const me: AwarenessUser = {
      pid: deps.pid,
      name: deps.name,
      slot,
      joinedAt: now(),
      ...presenceHex(slot || 1),
    };
    this.snapshot = {
      state: this.sync.state,
      savedLocally: !deps.persist,
      settings: null,
      people: [],
      me,
      full: false,
      turns: [],
      lock: null,
      model: readModelChoice(undefined),
      branches: [],
      activeBranch: MAIN_BRANCH,
      activeBranchBy: null,
      path: [],
      labels: {},
      roster: {},
      merges: [],
      context: [],
      systemLine: '',
      locked: deps.access?.room.locked ?? false,
      lockedBy: null,
      managed: deps.access?.backend.server === true,
      ended: null,
    };
  }

  private get managed(): RoomAccess | null {
    return this.deps.access?.backend.server ? this.deps.access : null;
  }

  /** this browser's participant id (the author id on text written here) */
  get pid(): string {
    return this.deps.pid;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const create = this.deps.create;
    if (this.deps.persist) {
      this.store = this.deps.persist(this.doc);
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
    this.doc.getMap('turns').observeDeep(this.onTurns);
    this.doc.getMap('lock').observe(this.onSettings);
    for (const name of ['branches', 'authors', 'people'])
      this.doc.getMap(name).observe(this.onTurns);
    this.doc.getArray('events').observe(this.onTurns);
    this.doc.getMap('context').observeDeep(this.onSettings);
    this.doc.getMap('access').observe(this.onAccess);
    this.sync.onState(this.onSyncState);
    this.sync.connect();
    this.startServerSide(create !== undefined);
    this.refresh();
  }

  /** Heartbeat, the saved copy on the server and the first snapshot of a new room. */
  private startServerSide(created: boolean): void {
    const access = this.managed;
    if (!access) return;
    this.doc.on('update', this.onDocUpdate);
    // First beat at once: it also takes the seat back if an earlier page gave it up while closing.
    void this.beat();
    this.heartbeat = setInterval(() => {
      void this.beat();
    }, access.heartbeatMs ?? HEARTBEAT_MS);
    if (created) {
      // a new room is saved straight away, so it can be opened even if its creator leaves now
      this.unsaved += 1;
      void Promise.resolve(this.store?.whenSynced).then(() => this.save());
    } else {
      void access.backend.loadSnapshot(access.room.id).then((state) => {
        if (state && !this.stopped) Y.applyUpdate(this.doc, state, SNAPSHOT_ORIGIN);
      });
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.awareness.off('change', this.onAwareness);
    this.doc.getMap('settings').unobserve(this.onSettings);
    this.doc.getMap('turns').unobserveDeep(this.onTurns);
    this.doc.getMap('lock').unobserve(this.onSettings);
    for (const name of ['branches', 'authors', 'people'])
      this.doc.getMap(name).unobserve(this.onTurns);
    this.doc.getArray('events').unobserve(this.onTurns);
    this.doc.getMap('context').unobserveDeep(this.onSettings);
    this.doc.getMap('access').unobserve(this.onAccess);
    this.doc.off('update', this.onDocUpdate);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.saveQuiet) clearTimeout(this.saveQuiet);
    if (this.saveLatest) clearTimeout(this.saveLatest);
    // Before sync stops: an answer this page is streaming is closed as "interrupted" and sent.
    this.stream.destroy();
    const access = this.managed;
    if (access && !this.snapshot.ended) {
      // last chance to put this page's changes on the server, then give the seat back
      if (this.unsaved > 0 && this.isWriter()) void this.sendSnapshot(access);
      access.backend.leave(access.room.id);
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

  /** The editor reports what this person is doing (shown in the people list). */
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
    this.awareness.setLocalStateField('activity', activity);
  }

  rename(name: string): void {
    this.publishMe({ ...this.snapshot.me, name });
  }

  /** Lock or unlock the room (host). The server decides; the room document shows it to all. */
  async setLocked(locked: boolean): Promise<ActionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.setLocked(access.room.id, locked);
    if (res.ok && !this.stopped) writeLocked(this.doc, locked, this.deps.pid);
    return res;
  }

  /** Remove a person for good (host). */
  async removePerson(pid: string): Promise<ActionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.removeMember(access.room.id, pid);
    if (res.ok && !this.stopped) markRemoved(this.doc, pid);
    return res;
  }

  /** Hand the room to another person who is in it (host). */
  async makeHost(pid: string): Promise<ActionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.transferHost(access.room.id, pid);
    if (res.ok && !this.stopped) writeHost(this.doc, pid);
    return res;
  }

  /** Delete the room for everyone (host). */
  async deleteRoom(): Promise<ActionResult> {
    const access = this.managed;
    if (!access) return { ok: false, reason: 'unavailable' };
    const res = await access.backend.deleteRoom(access.room.id);
    if (res.ok && !this.stopped) {
      markDeleted(this.doc); // the others see it at once and check with the server
      this.end('deleted');
    }
    return res;
  }

  private readonly onDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === SNAPSHOT_ORIGIN) return;
    this.unsaved += 1;
    this.scheduleSave();
  };

  /** The person who has been here longest saves the room (one writer, not eight). */
  private isWriter(): boolean {
    const me = this.snapshot.me;
    return this.others().every(
      (p) => me.joinedAt < p.joinedAt || (me.joinedAt === p.joinedAt && me.pid < p.pid),
    );
  }

  /** Save 10 s after the last change, and at least every 30 s while changes keep coming. */
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

  private sendSnapshot(access: RoomAccess): Promise<ActionResult> | null {
    const state = Y.encodeStateAsUpdate(this.doc);
    if (state.length > SNAPSHOT_MAX_BYTES) return null;
    return access.backend.saveSnapshot(access.room.id, state);
  }

  private async save(): Promise<void> {
    if (this.saveQuiet) clearTimeout(this.saveQuiet);
    if (this.saveLatest) clearTimeout(this.saveLatest);
    this.saveQuiet = this.saveLatest = null;
    const access = this.managed;
    if (!access || this.stopped || this.saving || this.unsaved === 0 || !this.isWriter()) return;
    const upTo = this.unsaved;
    this.saving = true;
    const res = await this.sendSnapshot(access);
    this.saving = false;
    if (res?.ok) this.unsaved -= upTo;
    // changes that arrived while saving, or a failed save: try again on the usual schedule
    if (this.unsaved > 0 && res !== null && (res.ok || res.reason === 'offline')) {
      this.scheduleSave();
    }
  }

  /** Heartbeat: keeps the seat; learns about a removal, a deleted room, a new host, the lock. */
  private async beat(): Promise<void> {
    const access = this.managed;
    if (!access || this.stopped || this.snapshot.ended) return;
    const now = Date.now();
    if (now - this.lastBeat < 1000) return; // several triggers at once: one question is enough
    this.lastBeat = now;
    const res = await access.backend.touch(access.room.id);
    if (this.isStopped()) return;
    if (!res.ok) {
      if (res.reason === 'removed') this.end('removed');
      else if (res.reason === 'not-member') this.end('deleted');
      return;
    }
    // the host's browser keeps what the room shows in line with the server
    if (res.room.hostUid === this.deps.pid && readSettings(this.doc)) {
      writeHost(this.doc, this.deps.pid);
      writeLocked(this.doc, res.room.locked, lockedBy(this.doc) ?? this.deps.pid);
    }
  }

  /** (a method, so the check is made again after every await) */
  private isStopped(): boolean {
    return this.stopped;
  }

  /** This person is out of the room: stop syncing, keep nothing on screen. */
  private end(reason: 'removed' | 'deleted'): void {
    if (this.snapshot.ended) return;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.update({ ended: reason });
    this.sync.destroy();
  }

  private readonly onAccess = () => {
    // A removed person's page may have been cut off before it could say goodbye: take them out of
    // the people list now. (If the mark is false they are still here and show up again by
    // themselves within seconds.)
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
    // "you were removed" / "room deleted" written by the host: believe it only if the server agrees
    if (isMarkedRemoved(this.doc, this.deps.pid) || isMarkedDeleted(this.doc)) void this.beat();
  };

  private createRoom(create: CreateOptions): void {
    const created = initRoom(this.doc, {
      name: create.name,
      sendPolicy: create.sendPolicy,
      hostPid: this.deps.pid,
      createdAt: (this.deps.now ?? Date.now)(),
    });
    if (created && create.fork) applyFork(this.doc, create.fork);
  }

  private readonly onAwareness = () => {
    this.reconcileSlot();
    this.refresh();
    // someone left: this page may be the one that saves now
    this.scheduleSave();
  };

  /** Settings, the send lock and context items: shown at once (a ticked box must not flicker). */
  private readonly onSettings = () => {
    this.refresh();
  };

  private turnsQueued = false;

  /** Answers grow many times a second: refresh at most once per frame. */
  private readonly onTurns = () => {
    if (this.turnsQueued) return;
    this.turnsQueued = true;
    const run = () => {
      this.turnsQueued = false;
      this.refresh();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  };

  private readonly onSyncState = (state: SyncState) => {
    if (state === 'synced' || state === 'alone') this.stream.resetStaleClock();
    // The live channel dropped: it may be a removal or a deleted room, so ask the server now
    // instead of waiting for the next heartbeat.
    if (state === 'connecting' && this.started) void this.beat();
    this.reconcileSlot();
    this.refresh();
    if (state === 'offline') this.update({ state });
  };

  /** Everyone else who is here now, one entry per person (several tabs count once). */
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
    const lock = readLock(this.doc);
    const people: PersonView[] = [
      { ...me, me: true, activity: this.activity, host: false },
      ...others,
    ]
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.pid < b.pid ? -1 : 1))
      .map((p) => ({
        ...p,
        host: settings?.hostPid === p.pid,
        ...(lock?.pid === p.pid ? { activity: 'sending' as const } : {}),
      }));
    const wasFull = this.snapshot.full;
    const turns = listTurns(this.doc);
    const model = readModelChoice(readRoomModel(this.doc));
    const branch = activeBranch(this.doc);
    const roster: Record<string, RosterEntry> = {};
    for (const [pid, a] of readAuthors(this.doc))
      roster[pid] = { name: a.name, slot: a.slot, from: a.from };
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
      turns,
      lock,
      model,
      branches: listBranches(this.doc),
      activeBranch: branch,
      activeBranchBy: activeBranchBy(this.doc),
      path: turnsOnPath(this.doc, branch),
      labels: Object.fromEntries(turnLabels(this.doc)),
      roster,
      merges: listMergeEvents(this.doc),
      context: listContext(this.doc),
      systemLine: readSystemLine(this.doc),
      locked: this.managed ? readLocked(this.doc) || this.initiallyLocked() : false,
      lockedBy: lockedBy(this.doc),
    });
    if (full && !wasFull) this.leaveBecauseFull();
  }

  /** Until the room document says otherwise, believe what the server said when we joined. */
  private initiallyLocked(): boolean {
    return this.deps.access?.room.locked === true && lockedBy(this.doc) === null;
  }

  private leaveBecauseFull(): void {
    if (this.stopped) return;
    // Stay out of the room: stop syncing so we take no slot and see nothing.
    this.sync.destroy();
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

function readActivity(value: unknown): Activity {
  return value === 'typing' || value === 'selecting' ? value : 'idle';
}

/** Validates another person's awareness "user" field (it comes from the network). */
export function readUser(value: unknown): AwarenessUser | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.pid !== 'string' || typeof v.name !== 'string') return null;
  if (typeof v.slot !== 'number' || typeof v.joinedAt !== 'number') return null;
  const slot = Math.min(8, Math.max(1, Math.round(v.slot)));
  return {
    pid: v.pid.slice(0, 64),
    name: v.name.slice(0, 24),
    slot,
    joinedAt: v.joinedAt,
    ...presenceHex(slot),
  };
}
