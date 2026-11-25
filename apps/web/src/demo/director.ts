import { MemoryHub, randomId } from '@promptalong/core';
import type { Provider } from '@promptalong/providers';
import { RoomSession } from '../room/session';
import { DemoBot, pause } from './bot';
import {
  BOTS,
  BRANCH_NAME,
  CONTEXT,
  DEMO_CODE,
  DEMO_ROOM_NAME,
  T1_AARAV,
  T1_MEERA,
  T2_AARAV,
  T2_MEERA,
  T3_AARAV_NOTES,
  T3_AARAV_START,
  T3_AARAV_THREE,
  T3_KABIR,
  T3_MEERA,
  type BotId,
} from './script';

export type DemoPhase = 'playing' | 'your-turn' | 'stopped';

export interface DemoOptions {
  /** the visitor's display name */
  visitorName: string;
  /** multiplies every pause (1 = real time; tests use a small number) */
  speed?: number;
  /** words appear whole instead of letter by letter (prefers-reduced-motion) */
  wholeWords?: boolean;
  /** the model the scripted people send with (default: the room's demo model) */
  provider?: Provider;
}

const LETTER_MS = 45;

/**
 * The live demo (F9): a room that exists only in this page. The visitor and three scripted
 * teammates are each a real room session on an in-page channel, so the demo runs the same sync,
 * authorship, context and stream code as a shared room - with no network, no server and no model
 * account. Nothing is saved: Replay or a reload starts from an empty room.
 */
export class DemoDirector {
  readonly visitor: RoomSession;
  private readonly bots: Record<BotId, DemoBot>;
  private readonly ctrl = new AbortController();
  private readonly speed: number;
  private phase: DemoPhase = 'playing';
  private readonly listeners = new Set<() => void>();

  private constructor(bots: Record<BotId, DemoBot>, visitor: RoomSession, speed: number) {
    this.bots = bots;
    this.visitor = visitor;
    this.speed = speed;
  }

  /** Opens the room: the scripted people join first (in mockup order), then the visitor. */
  static async open(options: DemoOptions): Promise<DemoDirector> {
    const hub = new MemoryHub();
    const speed = options.speed ?? 1;
    const timing = {
      letterMs: LETTER_MS * speed,
      wholeWords: options.wholeWords === true,
      provider: options.provider ?? null,
    };
    const join = (id: BotId) => {
      const s = new RoomSession({
        code: DEMO_CODE,
        pid: BOTS[id].pid,
        name: BOTS[id].name,
        transport: hub.createTransport(),
        ...(id === 'meera'
          ? { create: { name: DEMO_ROOM_NAME, sendPolicy: 'everyone' as const } }
          : {}),
      });
      s.start();
      return new DemoBot(s, timing);
    };
    // a couple of milliseconds apart: colours are handed out in join order
    const gap = () => new Promise((r) => setTimeout(r, 3));
    const aarav = join('aarav');
    await gap();
    const meera = join('meera');
    await gap();
    const kabir = join('kabir');
    await gap();
    const visitor = new RoomSession({
      code: DEMO_CODE,
      pid: `demo-you-${randomId()}`,
      name: options.visitorName,
      transport: hub.createTransport(),
    });
    visitor.start();
    return new DemoDirector({ aarav, meera, kabir }, visitor, speed);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getPhase = (): DemoPhase => this.phase;

  private setPhase(phase: DemoPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    for (const l of this.listeners) l();
  }

  /** Stops the script and closes every session of the demo room. */
  stop(): void {
    if (this.phase === 'stopped') return;
    this.ctrl.abort();
    this.setPhase('stopped');
    for (const bot of Object.values(this.bots)) bot.session.stop();
    this.visitor.stop();
  }

  /** Plays the story once; resolves when it is the visitor's turn (or the demo was stopped). */
  async play(): Promise<void> {
    try {
      await this.story();
      this.setPhase('your-turn');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    }
  }

  private async story(): Promise<void> {
    const { aarav, meera, kabir } = this.bots;
    const signal = this.ctrl.signal;
    const wait = (ms: number) => pause(ms * this.speed, signal);

    // Turn 1: context arrives while Aarav writes; Meera finishes the prompt and sends.
    await wait(800);
    meera.addContext(CONTEXT.criteria);
    await Promise.all([
      (async () => {
        await wait(300);
        await aarav.type(T1_AARAV, 'end', signal);
        aarav.addContext(CONTEXT.features);
      })(),
      (async () => {
        await wait(1800);
        kabir.addContext(CONTEXT.oldDraft);
      })(),
    ]);
    await wait(400);
    await meera.sees(T1_AARAV, signal);
    await meera.type(T1_MEERA, 'end', signal);
    await wait(600);
    meera.exclude(CONTEXT.oldDraft.title);
    await wait(900);
    await meera.sendAndWait(signal);

    // Turn 2: Kabir adds the survey and starts a branch; Meera and Aarav write the next prompt.
    await wait(700);
    kabir.addContext(CONTEXT.survey);
    await Promise.all([
      (async () => {
        await wait(400);
        await meera.type(T2_MEERA, 'end', signal);
        await aarav.sees(T2_MEERA, signal);
        await aarav.type(T2_AARAV, 'end', signal);
      })(),
      (async () => {
        await wait(2500);
        kabir.branch(BRANCH_NAME, 1);
      })(),
    ]);
    await wait(700);
    const t2 = await meera.send(signal);

    // Turn 3 is written while the answer streams: three people type in one prompt at once.
    await wait(600);
    await aarav.type(T3_AARAV_START, 'end', signal);
    await meera.sees(T3_AARAV_START, signal);
    await Promise.all([
      (async () => {
        await wait(200);
        await aarav.type(T3_AARAV_THREE.text, { before: T3_AARAV_THREE.before }, signal);
        await wait(300);
        await aarav.type(T3_AARAV_NOTES.text, { after: T3_AARAV_NOTES.after }, signal);
      })(),
      (async () => {
        await wait(400);
        await meera.type(T3_MEERA, 'end', signal);
      })(),
      (async () => {
        await wait(900);
        kabir.select('speaker notes');
        await wait(1800);
      })(),
    ]);
    await wait(300);
    await kabir.sees(T3_MEERA.trim(), signal);
    await kabir.sees(T3_AARAV_NOTES.text.trim(), signal);
    await kabir.type(T3_KABIR, 'end', signal);
    if (t2) await meera.waitFor(t2, signal);
    await wait(500);
    for (const bot of [aarav, meera, kabir]) bot.hideCursor();
  }
}
