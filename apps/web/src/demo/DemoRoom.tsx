import { MockProvider } from '@promptalong/providers';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { matchesMedia } from '../context/useMedia';
import { getDisplayName } from '../room/identity';
import { RoomView } from '../room/RoomView';
import { DemoBanner } from './DemoBanner';
import { DemoDirector, type DemoPhase } from './director';

/** The scripted teammates' answers stream a little slower, so turn 3 is written while one streams. */
const teammatesModel = new MockProvider({ chunkMs: 90 });

/** Runs `fn` after the next paint, when the browser is idle (or after 1.5 s at most). */
function whenIdle(fn: () => void): () => void {
  let idle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const frame = requestAnimationFrame(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(fn, { timeout: 1500 });
    } else {
      timer = setTimeout(fn, 300);
    }
  });
  return () => {
    cancelAnimationFrame(frame);
    if (idle !== null) window.cancelIdleCallback(idle);
    if (timer !== null) clearTimeout(timer);
  };
}

const noSubscribe = () => () => undefined;
const playing = (): DemoPhase => 'playing';

/**
 * The demo room itself (loaded after the light first view in DemoPage): the visitor's room is
 * drawn at once, the scripted teammates join when the page is idle.
 */
export default function DemoRoom({ fallback }: { fallback: ReactNode }) {
  const [run, setRun] = useState(0);
  const [director, setDirector] = useState<DemoDirector | null>(null);

  useEffect(() => {
    const d = new DemoDirector({
      visitorName: getDisplayName() ?? 'You',
      wholeWords: matchesMedia('(prefers-reduced-motion: reduce)'),
      provider: teammatesModel,
    });
    let alive = true;
    // shown from the next microtask (not during the effect, so React renders once)
    queueMicrotask(() => {
      if (alive) setDirector(d);
    });
    // the room is drawn first; the teammates join and the story starts once the page is idle
    const later = whenIdle(() => {
      void d.play();
    });
    return () => {
      alive = false;
      later();
      d.stop();
      setDirector(null);
    };
  }, [run]);

  const phase = useSyncExternalStore(
    director?.subscribe ?? noSubscribe,
    director?.getPhase ?? playing,
  );

  if (!director) return fallback;
  return (
    <RoomView
      key={run}
      session={director.visitor}
      openShare={false}
      demo={{
        banner: (
          <DemoBanner
            phase={phase}
            onReplay={() => {
              setRun((r) => r + 1);
            }}
          />
        ),
      }}
    />
  );
}
