/**
 * The demo room's story (F9, mockup 08): three scripted teammates prepare a hackathon pitch. Every
 * prompt below was chosen so the demo model's scripted answer fits it; the text is typed into the
 * shared prompt letter by letter, so the visitor sees cursors, authorship and one shared answer.
 */
export const DEMO_ROOM_NAME = 'Demo: Hackathon pitch';
/** shown in the room header; the demo room is never on a server, so it cannot be joined */
export const DEMO_CODE = 'K7QM2X';

export type BotId = 'aarav' | 'meera' | 'kabir';

/** Participant ids sort in join order, so the colours come out the same as in the mockup. */
export const BOTS: Record<BotId, { pid: string; name: string }> = {
  aarav: { pid: 'demo-1-aarav', name: 'Aarav' },
  meera: { pid: 'demo-2-meera', name: 'Meera' },
  kabir: { pid: 'demo-3-kabir', name: 'Kabir' },
};

export const CONTEXT = {
  criteria: {
    title: 'judging-criteria.txt',
    kind: 'file',
    text: [
      'Judging criteria - Campus Hack 2026',
      '1. Problem: is it real, and do the team show evidence? (30%)',
      '2. Solution: does it solve that problem simply? (30%)',
      '3. Demo: does it work in front of the judges? (25%)',
      '4. Pitch: clear story, on time, one clear ask. (15%)',
      'Each team has 2 minutes, then 1 minute of questions.',
    ].join('\n'),
  },
  features: {
    title: 'App features (notes)',
    kind: 'note',
    text: [
      'FoundIt - what works today:',
      '- Post a found item: photo, pin on the campus map, where it was handed in.',
      '- Search by place and day; owners get a notification on a likely match.',
      '- Lost-and-found desk staff can mark an item as collected.',
    ].join('\n'),
  },
  oldDraft: {
    title: 'Old pitch draft',
    kind: 'snippet',
    text: 'FoundIt is a platform leveraging geolocation to revolutionise lost property workflows across campuses.',
  },
  survey: {
    title: 'Survey numbers',
    kind: 'snippet',
    text: [
      'Survey of 40 students, 3 hostels, Nov 2026:',
      '31 of 40 lost something on campus this term.',
      '27 of those 31 never checked the lost-and-found desk.',
      '36 of 40 would post a found item on a map.',
    ].join('\n'),
  },
} as const;

/** Turn 1: Aarav starts, Meera adds the last sentence, Meera presses Send. */
export const T1_AARAV =
  'Write a 90-second hackathon pitch for FoundIt, our campus lost-and-found map.';
export const T1_MEERA = ' Follow the judging criteria.';

/** Turn 2: Meera starts, Aarav finishes. */
export const T2_MEERA = 'Make it 2 minutes, add a story about a real student';
export const T2_AARAV = ' and end with one clear ask for the judges.';

/**
 * Turn 3 is left for the visitor to send. Aarav writes the first sentence and fills it in while
 * Meera and Kabir type at the end at the same time:
 * "Now turn this into three slide titles with speaker notes. Keep the notes under 40 words each,
 * and make the ask from the closing line the last slide."
 */
export const T3_AARAV_START = 'Now turn this into slide titles.';
export const T3_AARAV_THREE = { before: 'slide titles', text: 'three ' };
export const T3_AARAV_NOTES = { after: 'slide titles', text: ' with speaker notes' };
export const T3_MEERA = ' Keep the notes under 40 words each';
export const T3_KABIR = ', and make the ask from the closing line the last slide.';
