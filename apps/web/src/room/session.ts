import {
  RoomSync,
  chooseSlot,
  initRoom,
  isOverCapacity,
  peopleMap,
  readSettings,
  upsertPerson,
  type PresentPerson,
  type RoomSettings,
  type SendPolicy,
  type SyncState,
  type Transport,
} from '@promptalong/core';
import { presenceHex } from '@promptalong/ui';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

export type Activity = 'typing' | 'selecting' | 'idle';

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
}

export interface CreateOptions {
  name: string;
  sendPolicy: SendPolicy;
}

export interface LocalStore {
  whenSynced: Promise<unknown>;
  destroy(): unknown;
}

export interface RoomSessionDeps {
  code: string;
  pid: string;
  name: string;
  transport: Transport;
  /** local persistence (y-indexeddb in the app; omitted in tests) */
  persist?: (doc: Y.Doc) => LocalStore;
  create?: CreateOptions;
  now?: () => number;
}

/**
 * One open room: the Yjs document, awareness, local persistence and sync. React reads it through
 * subscribe/getSnapshot (useSyncExternalStore).
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
  private started = false;
  private stopped = false;
  private activity: Activity = 'idle';
  private typingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: RoomSessionDeps) {
    this.deps = deps;
    this.code = deps.code;
    this.awareness = new Awareness(this.doc);
    this.sync = new RoomSync(this.doc, this.awareness, deps.transport);
    const now = deps.now ?? Date.now;
    const remembered = peopleMap(this.doc).get(deps.pid);
    const slot = remembered?.slot ?? 0;
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
    };
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
    this.sync.onState(this.onSyncState);
    this.sync.connect();
    this.refresh();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.awareness.off('change', this.onAwareness);
    this.doc.getMap('settings').unobserve(this.onSettings);
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
  };

  private readonly onSettings = () => {
    this.refresh();
  };

  private readonly onSyncState = (state: SyncState) => {
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
    const people: PersonView[] = [
      { ...me, me: true, activity: this.activity, host: false },
      ...others,
    ]
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.pid < b.pid ? -1 : 1))
      .map((p) => ({ ...p, host: settings?.hostPid === p.pid }));
    const wasFull = this.snapshot.full;
    this.update({ state, settings, people, full });
    if (full && !wasFull) this.leaveBecauseFull();
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
