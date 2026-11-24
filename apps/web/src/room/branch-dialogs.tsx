import * as Dialog from '@radix-ui/react-dialog';
import {
  BRANCH_NAME_MAX,
  cleanBranchName,
  diffWords,
  type MergePlan,
  type Para,
  type Resolution,
  type TurnView,
} from '@promptalong/core';
import { Button, cx } from '@promptalong/ui';
import { useId, useState } from 'react';
import { AttributedText } from './AuthorText';
import type { Roster } from './authors';
import { DialogShell } from './dialogs';

const field =
  'h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-[15px] text-text';
const label = 'mb-1.5 block text-sm font-semibold';

function titleOf(turn: TurnView): string {
  const t = turn.prompt.text.replace(/\s+/gu, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

/** Mockup 12 A. */
export function BranchDialog({
  open,
  onOpenChange,
  turn,
  turnLabel,
  taken,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turn: TurnView | null;
  turnLabel: string;
  taken: string[];
  onCreate: (name: string, switchNow: boolean) => void;
}) {
  const ids = { name: useId(), sw: useId() };
  const [name, setName] = useState('');
  const [switchNow, setSwitchNow] = useState(true);
  const clean = cleanBranchName(name);
  const problem = !clean
    ? 'Type a name with at least one letter or number.'
    : clean === 'main' || taken.includes(clean)
      ? `A branch called "${clean}" already exists.`
      : null;
  const n = turnLabel.replace(/^T/u, '');
  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) setName('');
        onOpenChange(o);
      }}
      title={`Branch from turn ${n}`}
      footer={
        <>
          <Dialog.Close asChild>
            <Button>Cancel</Button>
          </Dialog.Close>
          <Button
            variant="primary"
            disabled={problem !== null}
            onClick={() => {
              onCreate(clean, switchNow);
              setName('');
              onOpenChange(false);
            }}
          >
            Create branch
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-text-muted">
        A new branch starts after "{turn ? titleOf(turn) : ''}". It gets its own draft prompt; the
        branch you are on stays as it is.
      </p>
      <label className={label} htmlFor={ids.name}>
        Branch name
      </label>
      <input
        id={ids.name}
        className={field}
        value={name}
        maxLength={BRANCH_NAME_MAX + 10}
        placeholder="shorter-version"
        autoComplete="off"
        onChange={(e) => {
          setName(e.target.value);
        }}
        data-testid="branch-name"
      />
      {name && problem ? <p className="mt-1.5 text-xs text-danger">{problem}</p> : null}
      {name && clean && clean !== name ? (
        <p className="mt-1.5 text-xs text-text-muted">Saved as "{clean}".</p>
      ) : null}
      <label className="mt-3.5 flex items-center gap-2.5 text-sm" htmlFor={ids.sw}>
        <input
          id={ids.sw}
          type="checkbox"
          checked={switchNow}
          onChange={(e) => {
            setSwitchNow(e.target.checked);
          }}
          className="size-4 accent-[var(--c-accent)]"
        />
        Switch the room to this branch now
      </label>
      <p className="mt-1.5 text-xs text-text-muted">
        Switching changes the shared editor for everyone in the room.
      </p>
    </DialogShell>
  );
}

/** Mockup 12 B. */
export function ForkDialog({
  open,
  onOpenChange,
  path,
  labels,
  branchName,
  roomName,
  roomCode,
  onFork,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  path: TurnView[];
  labels: Record<string, string>;
  branchName: string;
  roomName: string;
  roomCode: string;
  onFork: (uptoTurnId: string, name: string) => void;
}) {
  const ids = { upto: useId(), name: useId() };
  const [upto, setUpto] = useState('');
  const [name, setName] = useState('');
  const last = path.at(-1)?.id ?? '';
  const chosen = path.some((t) => t.id === upto) ? upto : last;
  const roomNameValue = name || `${roomName} - copy`;
  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setUpto('');
          setName('');
        }
        onOpenChange(o);
      }}
      title="Fork this room"
      footer={
        <>
          <Dialog.Close asChild>
            <Button>Cancel</Button>
          </Dialog.Close>
          <Button
            variant="primary"
            disabled={!chosen}
            onClick={() => {
              onFork(chosen, roomNameValue);
              onOpenChange(false);
            }}
          >
            Fork room
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-text-muted">
        Copies the conversation up to the chosen turn into a new room with a new code. You become
        its host.
      </p>
      {path.length === 0 ? (
        <p className="text-sm">Send at least one prompt first - a fork copies turns.</p>
      ) : (
        <>
          <label className={label} htmlFor={ids.upto}>
            Copy up to
          </label>
          <select
            id={ids.upto}
            className={field}
            value={chosen}
            onChange={(e) => {
              setUpto(e.target.value);
            }}
          >
            {path.map((t, i) => (
              <option key={t.id} value={t.id}>
                {branchName} · turn {labels[t.id]?.replace(/^T/u, '') ?? String(i + 1)} ({i + 1}{' '}
                {i === 0 ? 'turn' : 'turns'})
              </option>
            ))}
          </select>
          <label className={cx(label, 'mt-3.5')} htmlFor={ids.name}>
            New room name
          </label>
          <input
            id={ids.name}
            className={field}
            value={roomNameValue}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <p className="mt-3 text-xs text-text-muted">
            Authors keep their names, marked "from room {roomCode}". Model keys are never copied.
            Context items arrive in a later update.
          </p>
        </>
      )}
    </DialogShell>
  );
}

function ParaDiff({
  paras,
  against,
  roster,
  me,
}: {
  paras: Para[];
  against: Para[];
  roster: Roster;
  me: string;
}) {
  const text = paras.map((p) => p.text).join('\n');
  const old = against.map((p) => p.text).join('\n');
  if (!old) {
    return (
      <>
        {paras.map((p, i) => (
          <p key={i}>
            <AttributedText text={p.text} spans={p.spans} roster={roster} me={me} show />
          </p>
        ))}
      </>
    );
  }
  return (
    <p className="whitespace-pre-wrap">
      {diffWords(old, text).map((part, i) =>
        part.type === 'removed' ? (
          <del key={i} className="mr-[0.3em] text-danger">
            {part.text}
          </del>
        ) : part.type === 'added' ? (
          <ins key={i} className="bg-accent-soft no-underline">
            {part.text}
          </ins>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/** Mockup 12 C. */
export function MergeDialog({
  open,
  onOpenChange,
  plan,
  fromName,
  intoName,
  roster,
  me,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: MergePlan | null;
  fromName: string;
  intoName: string;
  roster: Roster;
  me: string;
  onMerge: (choices: Resolution[]) => void;
}) {
  const [choices, setChoices] = useState<Resolution[]>([]);
  if (!plan) return null;
  const conflicts = plan.chunks.flatMap((c) => (c.kind === 'conflict' ? [c] : []));
  const allChosen = conflicts.every((_, i) => choices[i] !== undefined);
  const changed = plan.clean;
  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) setChoices([]);
        onOpenChange(o);
      }}
      wide
      title={`Merge "${fromName}" into ${intoName}`}
      footer={
        <>
          <Dialog.Close asChild>
            <Button>Cancel</Button>
          </Dialog.Close>
          <Button
            variant="primary"
            disabled={!allChosen}
            onClick={() => {
              onMerge(choices);
              setChoices([]);
              onOpenChange(false);
            }}
          >
            Merge into {intoName}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-text-muted">
        {changed === 0 && conflicts.length === 0
          ? `${intoName} already has everything from ${fromName}'s prompt.`
          : `${String(changed)} ${changed === 1 ? 'paragraph merges' : 'paragraphs merge'} cleanly.`}{' '}
        {conflicts.length > 0
          ? `${String(conflicts.length)} ${conflicts.length === 1 ? 'paragraph was' : 'paragraphs were'} changed on both branches - pick what to keep. `
          : ''}
        Author marks are kept either way. The result goes into {intoName}'s draft prompt, ready to
        send.
      </p>
      <div className="flex flex-col gap-3">
        {conflicts.map((c, i) => (
          <div
            key={i}
            className="rounded-lg border border-border-strong"
            data-testid="merge-conflict"
          >
            <div className="flex justify-between rounded-t-lg bg-surface-2 px-3.5 py-2 text-xs font-semibold">
              <span>Conflict {i + 1}</span>
              <span>changed on both</span>
            </div>
            <div className="grid grid-cols-2 max-md:grid-cols-1">
              <div className="border-r border-border p-3.5 text-sm max-md:border-r-0 max-md:border-b">
                <p className="mb-1.5 text-xs font-semibold tracking-wider text-text-muted uppercase">
                  {intoName} (ours)
                </p>
                <ParaDiff paras={c.ours} against={c.base} roster={roster} me={me} />
              </div>
              <div className="p-3.5 text-sm">
                <p className="mb-1.5 text-xs font-semibold tracking-wider text-text-muted uppercase">
                  {fromName} (theirs)
                </p>
                <ParaDiff paras={c.theirs} against={c.base} roster={roster} me={me} />
              </div>
            </div>
            <div
              className="flex gap-2 border-t border-border p-3"
              role="radiogroup"
              aria-label={`Conflict ${String(i + 1)}`}
            >
              {(['ours', 'theirs', 'both'] as const).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  role="radio"
                  aria-checked={choices[i] === r}
                  className={cx(choices[i] === r && 'border-2 border-accent text-accent')}
                  onClick={() => {
                    setChoices((prev) => {
                      const next = [...prev];
                      next[i] = r;
                      return next;
                    });
                  }}
                >
                  {r === 'ours' ? 'Keep ours' : r === 'theirs' ? 'Keep theirs' : 'Keep both'}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-text-muted">
        The merge is recorded in the tree: who merged, from which branch, into which. Nothing in
        either branch is deleted.
      </p>
    </DialogShell>
  );
}

export function RenameBranchDialog({
  open,
  onOpenChange,
  current,
  taken,
  onRename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string;
  taken: string[];
  onRename: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(current);
  const clean = cleanBranchName(name);
  const bad = !clean || clean === 'main' || (clean !== current && taken.includes(clean));
  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (o) setName(current);
        onOpenChange(o);
      }}
      title="Rename branch"
      footer={
        <>
          <Dialog.Close asChild>
            <Button>Cancel</Button>
          </Dialog.Close>
          <Button
            variant="primary"
            disabled={bad}
            onClick={() => {
              onRename(clean);
              onOpenChange(false);
            }}
          >
            Rename
          </Button>
        </>
      }
    >
      <label className={label} htmlFor={id}>
        Branch name
      </label>
      <input
        id={id}
        className={field}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
    </DialogShell>
  );
}
