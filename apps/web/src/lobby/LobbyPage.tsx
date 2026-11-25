import {
  ROOM_CODE_LENGTH,
  cleanDisplayName,
  createRoomCode,
  normalizeRoomCode,
  type SendPolicy,
} from '@promptalong/core';
import { Button, Card, cx, initials, presenceHex } from '@promptalong/ui';
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
            'h-[52px] w-full min-w-0 rounded-md border bg-surface text-center font-mono text-[22px] font-semibold text-text uppercase',
            invalid ? 'border-danger' : 'border-border-strong',
          )}
        />
      ))}
    </div>
  );
}

function Choice({
  checked,
  title,
  body,
  value,
  onSelect,
}: {
  checked: boolean;
  title: string;
  body: string;
  value: SendPolicy;
  onSelect: (v: SendPolicy) => void;
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer gap-2.5 rounded-lg border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring',
        checked ? 'border-accent border-2 p-[11px]' : 'border-border-strong',
      )}
    >
      <input
        type="radio"
        name="send-policy"
        value={value}
        checked={checked}
        onChange={() => {
          onSelect(value);
        }}
        className="mt-0.5 size-[18px] accent-[var(--c-accent)]"
      />
      <span>
        <b className="block text-sm">{title}</b>
        <span className="mt-0.5 block text-xs leading-snug text-text-muted">{body}</span>
      </span>
    </label>
  );
}

export function LobbyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [roomName, setRoomName] = useState('');
  const [policy, setPolicy] = useState<SendPolicy>('everyone');
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
    const newCode = createRoomCode();
    void navigate(`/r/${newCode}`, {
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

  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[1040px] px-4 pt-6 pb-12 md:px-6 md:pt-12">
        <h1 className="text-[28px] font-bold md:text-[36px]">Start or join a room</h1>
        <p className="mt-2 text-text-muted">
          Rooms hold up to 8 people. Anyone with the link or code can join until you lock the room.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card className="p-7 max-md:p-5">
            <h2 className="text-[22px] font-bold">Start a new room</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <label htmlFor="room-name" className="mt-5 mb-1.5 block text-sm font-semibold">
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
                className="h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-text placeholder:text-text-muted"
              />
              <fieldset className="mt-5">
                <legend className="mb-2 text-sm">Who can press Send</legend>
                <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
                  <Choice
                    checked={policy === 'everyone'}
                    value="everyone"
                    title="Everyone"
                    body="Any participant can send the prompt."
                    onSelect={setPolicy}
                  />
                  <Choice
                    checked={policy === 'host'}
                    value="host"
                    title="Host only"
                    body="Only you can send. Others co-write."
                    onSelect={setPolicy}
                  />
                </div>
              </fieldset>
              <p className="mt-5 mb-1.5 text-sm">Model to start with</p>
              <div className="flex h-11 items-center justify-between rounded-md border border-border-strong bg-surface px-3">
                <span>Demo model (scripted, no key needed)</span>
                <span className="text-xs text-text-muted">Change later</span>
              </div>
              <Button type="submit" variant="primary" size="lg" className="mt-[22px] w-full">
                Create room
              </Button>
            </form>
          </Card>

          <Card className="p-7 max-md:p-5">
            <h2 id="join" ref={joinRef} className="scroll-mt-4 text-[22px] font-bold">
              Join with a code
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                join();
              }}
            >
              <p className="mt-5 mb-1.5 text-sm font-semibold">Room code</p>
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
              <p
                className={cx('mt-1.5 text-xs', codeInvalid ? 'text-danger' : 'text-text-muted')}
                role={codeInvalid ? 'alert' : undefined}
              >
                {codeInvalid
                  ? 'Codes are 6 letters and numbers, like K7Q-M2X.'
                  : 'Or open the link your teammate shared.'}
              </p>
              <Button type="submit" size="lg" className="mt-[22px] w-full">
                Join room
              </Button>
            </form>
            <hr className="mt-6 border-0 border-t border-border" />
            <div className="mt-6 flex items-center gap-3 rounded-md bg-surface-2 p-3">
              <span
                aria-hidden="true"
                className="grid size-10 flex-none place-items-center rounded-full text-sm font-bold"
                style={{ background: preview.color, color: preview.label }}
              >
                {name.trim() ? initials(name) : '?'}
              </span>
              <div className="flex-1">
                <label htmlFor="display-name" className="mb-1 block text-sm font-semibold">
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
              className={cx('mt-2 text-xs', nameInvalid ? 'text-danger' : 'text-text-muted')}
              role={nameInvalid ? 'alert' : undefined}
            >
              {nameInvalid
                ? 'Add your name first - it is shown next to your cursor.'
                : 'Shown next to your cursor and on every part of the prompt you write. Your colour is set when you join.'}
            </p>
          </Card>
        </div>
      </main>
    </>
  );
}
