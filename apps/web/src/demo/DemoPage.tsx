import { MockProvider } from '@promptalong/providers';
import { Button, buttonClass } from '@promptalong/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { matchesMedia } from '../context/useMedia';
import { getDisplayName } from '../room/identity';
import { RoomView } from '../room/RoomView';
import { DemoDirector, type DemoPhase } from './director';

/** The scripted teammates' answers stream a little slower, so turn 3 is written while one streams. */
const teammatesModel = new MockProvider({ chunkMs: 90 });

const noSubscribe = () => () => undefined;
const playing = (): DemoPhase => 'playing';

function DemoBanner({ phase, onReplay }: { phase: DemoPhase; onReplay: () => void }) {
  return (
    <section
      aria-label="Live demo"
      className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 bg-warning-bg px-4 py-2.5 text-sm text-warning-text max-md:px-3 max-md:py-2 max-md:text-xs"
      data-testid="demo-banner"
    >
      <p className="min-w-0 flex-1 basis-[260px]" role="status" data-testid="demo-phase">
        <b className="mr-1.5">Live demo</b>
        {phase === 'your-turn'
          ? 'Your turn: the next prompt is ready. Press Send, or change it first - it is your room now.'
          : 'Aarav, Meera and Kabir are scripted, and answers come from the demo model. Type anywhere to join in.'}
      </p>
      <span className="flex flex-none gap-2">
        <Button size="sm" onClick={onReplay} data-testid="demo-replay">
          Replay
        </Button>
        <Link to="/new" className={buttonClass({ size: 'sm', variant: 'primary' })}>
          Start your own room
        </Link>
      </span>
    </section>
  );
}

/**
 * /demo (F9, mockup 08): a room that lives only in this page, with three scripted teammates and
 * the demo model. No server, no model account, no network - and nothing is saved.
 */
export function DemoPage() {
  const [run, setRun] = useState(0);
  const [director, setDirector] = useState<DemoDirector | null>(null);

  useEffect(() => {
    let alive = true;
    let opened: DemoDirector | null = null;
    void DemoDirector.open({
      visitorName: getDisplayName() ?? 'You',
      wholeWords: matchesMedia('(prefers-reduced-motion: reduce)'),
      provider: teammatesModel,
    }).then((d) => {
      if (!alive) {
        d.stop();
        return;
      }
      opened = d;
      setDirector(d);
      void d.play();
    });
    return () => {
      alive = false;
      opened?.stop();
      setDirector(null);
    };
  }, [run]);

  const phase = useSyncExternalStore(
    director?.subscribe ?? noSubscribe,
    director?.getPhase ?? playing,
  );

  if (!director) {
    return (
      <p className="p-8 text-center text-sm text-text-muted" role="status">
        Opening the demo room…
      </p>
    );
  }
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
