import {
  ROOM_CODE_LENGTH,
  cleanDisplayName,
  createRoomCode,
  normalizeRoomCode,
  type SendPolicy,
} from '@promptalong/core';
import { Button, cx, initials, presenceHex } from '@promptalong/ui';
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { SiteNav } from '../components/SiteNav';
import { cleanCodeChar } from './code';
import { NameField } from '../room/dialogs';
import { getDisplayName, saveDisplayName } from '../room/identity';

export function CodeInput({
  value,
  onChange,
  onComplete,
  invalid,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  onComplete: () => void;
  invalid: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) =>
    refs.current[Math.max(0, Math.min(ROOM_CODE_LENGTH - 1, i))]?.focus();

  const setAt = (i: number, ch: string) => {
    const next = [...value];
    next[i] = ch;
    onChange(next);
    return next;
  };

  const fill = (start: number, text: string) => {
    const chars = text.split('').map(cleanCodeChar).filter(Boolean);
    const next = [...value];
    let i = start;
    for (const c of chars) {
      if (i >= ROOM_CODE_LENGTH) break;
      next[i] = c;
      i += 1;
    }
    onChange(next);
    focus(i);
    if (next.every(Boolean)) onComplete();
  };

  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[i]) {
      e.preventDefault();
      setAt(i - 1 >= 0 ? i - 1 : 0, '');
      focus(i - 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(i + 1);
    }
  };

  return (
    <div className="flex gap-2" role="group" aria-label="6-character room code">
      {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] ?? ''}
          aria-label={`Character ${i + 1} of ${ROOM_CODE_LENGTH}`}
          aria-invalid={invalid ? true : undefined}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={ROOM_CODE_LENGTH}
          data-testid={`code-${i}`}
          onChange={(e) => {
            fill(i, e.target.value.slice(-ROOM_CODE_LENGTH));
          }}
          onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
            e.preventDefault();
            fill(0, e.clipboardData.getData('text').replace(/[\s-]/gu, ''));
          }}
          onKeyDown={onKey(i)}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          className={cx(
            'h-[52px] w-full min-w-0 rounded-xl border bg-surface text-center font-mono text-[22px] font-semibold text-text uppercase',
            invalid ? 'border-danger' : 'border-border-strong',
          )}
        />
      ))}
    </div>
  );
}

export function LobbyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [roomName, setRoomName] = useState('');
  const [hostOnly, setHostOnly] = useState(false);
  const [code, setCode] = useState<string[]>(() =>
    Array.from({ length: ROOM_CODE_LENGTH }, () => ''),
  );
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [name, setName] = useState(() => getDisplayName() ?? '');
  const [nameInvalid, setNameInvalid] = useState(false);
  const joinRef = useRef<HTMLHeadingElement>(null);
  const preview = presenceHex(1);

  useEffect(() => {
    if (location.hash === '#join') joinRef.current?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const requireName = (): string | null => {
    const clean = cleanDisplayName(name);
    setNameInvalid(!clean);
    if (!clean) {
      document.getElementById('display-name')?.focus();
      return null;
    }
    saveDisplayName(clean);
    return clean;
  };

  const create = () => {
    if (!requireName()) return;
    const policy: SendPolicy = hostOnly ? 'host' : 'everyone';
    void navigate(`/r/${createRoomCode()}`, {
      state: { create: { name: roomName, sendPolicy: policy }, share: true },
    });
  };

  const join = () => {
    const normal = normalizeRoomCode(code.join(''));
    setCodeInvalid(!normal);
    if (!normal) return;
    if (!requireName()) return;
    void navigate(`/r/${normal}`);
  };

  const field =
    'h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-base text-text placeholder:text-text-muted';

  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[460px] px-4 pt-8 pb-16 md:pt-14">
        <h1 className="text-[30px] font-bold tracking-[-0.03em] md:text-[36px]">
          Start or join a room
        </h1>
        <p className="mt-2 text-text-muted">
          Up to 8 people write one prompt together. No sign-up.
        </p>

        <div className="mt-8 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 flex-none place-items-center rounded-full text-sm font-bold"
            style={{ background: preview.color, color: preview.label }}
          >
            {name.trim() ? initials(name) : '?'}
          </span>
          <div className="flex-1">
            <label htmlFor="display-name" className="mb-1 block text-sm font-medium">
              Your display name
            </label>
            <NameField
              id="display-name"
              value={name}
              onChange={(v) => {
                setName(v);
                setNameInvalid(false);
              }}
              invalid={nameInvalid}
            />
          </div>
        </div>
        <p
          className={cx('mt-1.5 pl-14 text-xs', nameInvalid ? 'text-danger' : 'text-text-muted')}
          role={nameInvalid ? 'alert' : undefined}
        >
          {nameInvalid
            ? 'Add your name first - it is shown next to your cursor.'
            : 'Shown next to your cursor and on what you write.'}
        </p>

        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <h2 className="text-lg font-semibold">New room</h2>
          <label htmlFor="room-name" className="mt-3 mb-1.5 block text-sm font-medium">
            Room name
          </label>
          <input
            id="room-name"
            value={roomName}
            maxLength={60}
            placeholder="Untitled room"
            onChange={(e) => {
              setRoomName(e.target.value);
            }}
            className={field}
          />
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={hostOnly}
              onChange={(e) => {
                setHostOnly(e.target.checked);
              }}
              className="mt-0.5 size-[18px] accent-[var(--c-accent)]"
              data-testid="host-only"
            />
            <span>
              Only I can press Send
              <span className="block text-xs text-text-muted">
                Everyone still writes the prompt with you. You can change the model inside the room.
              </span>
            </span>
          </label>
          <Button type="submit" variant="primary" size="lg" className="mt-5 w-full rounded-xl">
            Create room
          </Button>
        </form>

        <div className="my-8 flex items-center gap-3 text-xs text-text-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <h2 id="join" ref={joinRef} className="scroll-mt-4 text-lg font-semibold">
            Join with a code
          </h2>
          <div className="mt-3">
            <CodeInput
              value={code}
              onChange={(v) => {
                setCode(v);
                setCodeInvalid(false);
              }}
              onComplete={() => {
                setCodeInvalid(false);
              }}
              invalid={codeInvalid}
            />
          </div>
          <p
            className={cx('mt-1.5 text-xs', codeInvalid ? 'text-danger' : 'text-text-muted')}
            role={codeInvalid ? 'alert' : undefined}
          >
            {codeInvalid
              ? 'Codes are 6 letters and numbers, like K7Q-M2X.'
              : 'Or open the link your teammate shared.'}
          </p>
          <Button type="submit" size="lg" className="mt-4 w-full rounded-xl">
            Join room
          </Button>
        </form>
      </main>
    </>
  );
}
