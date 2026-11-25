import {
  MAIN_BRANCH,
  listBranches,
  listContext,
  promptFragment,
  promptText,
  readParagraphs,
  readSettings,
  turnsOnPath,
} from '@promptalong/core';
import { MockProvider } from '@promptalong/providers';
import { DemoDirector } from './director';
import { BOTS, BRANCH_NAME, CONTEXT, DEMO_ROOM_NAME } from './script';

const T3 =
  'Now turn this into three slide titles with speaker notes. Keep the notes under 40 words each, and make the ask from the closing line the last slide.';

let director: DemoDirector | null = null;

afterEach(() => {
  director?.stop();
  director = null;
});

const fast = { speed: 0.01, provider: new MockProvider({ chunkMs: 1 }) };

describe('DemoDirector', () => {
  it('plays the story into the visitor room and hands over turn 3', async () => {
    director = await DemoDirector.open({ visitorName: 'You', ...fast });
    const doc = director.visitor.doc;
    await director.play();
    expect(director.getPhase()).toBe('your-turn');
    await vi.waitFor(() => {
      expect(promptText(doc)).toBe(T3);
    });

    expect(readSettings(doc)).toMatchObject({ name: DEMO_ROOM_NAME, hostPid: BOTS.meera.pid });
    const turns = turnsOnPath(doc, MAIN_BRANCH);
    expect(turns.map((t) => t.prompt.text)).toEqual([
      'Write a 90-second hackathon pitch for FoundIt, our campus lost-and-found map. Follow the judging criteria.',
      'Make it 2 minutes, add a story about a real student and end with one clear ask for the judges.',
    ]);
    expect(turns.map((t) => t.status)).toEqual(['done', 'done']);
    expect(turns.map((t) => t.sentBy)).toEqual([BOTS.meera.pid, BOTS.meera.pid]);
    // two people wrote turn 1, and the answer is the demo model's pitch script
    expect(new Set(turns[0]?.prompt.spans.map((s) => s.uid))).toEqual(
      new Set([BOTS.aarav.pid, BOTS.meera.pid]),
    );
    expect(turns[0]?.answer).toMatch(/^Here is a first pass/u);
    expect(turns[1]?.answer).toMatch(/^A sharper version/u);

    // turn 3 was written by three people at once
    const [para] = readParagraphs(promptFragment(doc));
    expect(new Set(para?.spans.map((s) => s.uid))).toEqual(
      new Set([BOTS.aarav.pid, BOTS.meera.pid, BOTS.kabir.pid]),
    );

    const ctx = listContext(doc);
    expect(ctx.map((c) => c.title).sort()).toEqual(
      [
        CONTEXT.criteria.title,
        CONTEXT.features.title,
        CONTEXT.oldDraft.title,
        CONTEXT.survey.title,
      ].sort(),
    );
    expect(ctx.find((c) => c.title === CONTEXT.oldDraft.title)).toMatchObject({
      included: false,
      toggledBy: BOTS.meera.pid,
    });
    expect(listBranches(doc).map((b) => b.name)).toContain(BRANCH_NAME);

    // the people list: three teammates, then the visitor, in the mockup's colours
    const people = director.visitor.getSnapshot().people;
    expect(people.map((p) => [p.name, p.slot])).toEqual([
      ['Aarav', 1],
      ['Meera', 2],
      ['Kabir', 3],
      ['You', 4],
    ]);
  }, 20_000);

  it('Stop ends the script at once and closes every session', async () => {
    director = await DemoDirector.open({ visitorName: 'You', ...fast });
    const playing = director.play();
    director.stop();
    await playing;
    expect(director.getPhase()).toBe('stopped');
    expect(promptText(director.visitor.doc)).toBe('');
  });

  it('the visitor can send in the middle of the story; the script waits and carries on', async () => {
    director = await DemoDirector.open({ visitorName: 'You', ...fast });
    const visitor = director.visitor;
    const playing = director.play();
    await vi.waitFor(() => {
      expect(promptText(visitor.doc)).toContain('hackathon pitch');
    });
    // the visitor presses Send with half of turn 1 written
    const { sendPrompt } = await import('../room/send');
    await sendPrompt(visitor, undefined, undefined, fast.provider);
    await playing;
    expect(director.getPhase()).toBe('your-turn');
    const turns = turnsOnPath(visitor.doc, MAIN_BRANCH);
    expect(turns.length).toBeGreaterThanOrEqual(3);
    expect(turns.every((t) => t.status === 'done')).toBe(true);
  }, 20_000);
});
