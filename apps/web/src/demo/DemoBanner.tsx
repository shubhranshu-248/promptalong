import { Button, buttonClass } from '@promptalong/ui';
import { Link } from 'react-router';
import type { DemoPhase } from './director';

/** The live demo's banner (mockup 08). `onReplay` is missing while the room is still loading. */
export function DemoBanner({ phase, onReplay }: { phase: DemoPhase; onReplay?: () => void }) {
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
        <Button size="sm" onClick={onReplay} disabled={!onReplay} data-testid="demo-replay">
          Replay
        </Button>
        <Link to="/new" className={buttonClass({ size: 'sm', variant: 'primary' })}>
          Start your own room
        </Link>
      </span>
    </section>
  );
}
