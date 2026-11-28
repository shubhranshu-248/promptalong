import { Button, buttonClass } from '@promptalong/ui';
import { Link } from 'react-router';
import type { DemoPhase } from './director';

/** The live demo's banner (mockup 08). `onReplay` is missing while the room is still loading. */
export function DemoBanner({ phase, onReplay }: { phase: DemoPhase; onReplay?: () => void }) {
  return (
    <section
      aria-label="Live demo"
      className="flex flex-none items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-4 py-2 text-sm max-md:px-3 max-md:text-xs"
      data-testid="demo-banner"
    >
      <p className="min-w-0 flex-1" role="status" data-testid="demo-phase">
        <b className="mr-1.5 rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
          Live demo
        </b>
        {phase === 'your-turn' ? (
          <>
            <span className="max-md:sr-only">
              Your turn: the next prompt is ready. Press Send, or change it first.
            </span>
          </>
        ) : (
          <>
            <span className="max-md:sr-only">
              Aarav, Meera and Kabir are scripted and the demo model answers. Type in the prompt to
              join in.
            </span>
          </>
        )}
      </p>
      <span className="flex flex-none gap-2">
        <Button
          size="sm"
          className="rounded-pill"
          onClick={onReplay}
          disabled={!onReplay}
          data-testid="demo-replay"
        >
          Replay
        </Button>
        <Link
          to="/new"
          className={`${buttonClass({ size: 'sm', variant: 'primary' })} rounded-pill`}
        >
          Start your own room
        </Link>
      </span>
    </section>
  );
}
