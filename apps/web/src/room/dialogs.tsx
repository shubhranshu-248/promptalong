import * as Dialog from '@radix-ui/react-dialog';
import { QrCode } from './QrCode';
import { formatRoomCode } from '@promptalong/core';
import { Button, cx } from '@promptalong/ui';
import { useState, type ReactNode } from 'react';

const overlay =
  'fixed inset-0 z-[50] grid place-items-center bg-[rgba(17,18,24,.45)] p-6 max-md:place-items-end max-md:p-0';
const panel =
  'flex max-h-[calc(100vh-48px)] flex-col overflow-hidden rounded-xl bg-surface shadow-lg ' +
  'max-md:max-h-[92vh] max-md:w-full max-md:rounded-b-none';

export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** 640 px instead of 520 px */
  wide?: boolean;
  /** fixed action bar under the scrolling content */
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay}>
          <Dialog.Content
            className={cx(panel, wide ? 'w-[min(640px,100%)]' : 'w-[min(520px,100%)]')}
            {...(description ? {} : { 'aria-describedby': undefined })}
          >
            <header className="flex items-center gap-3 border-b border-border px-6 py-5 max-md:px-4">
              <Dialog.Title className="flex-1 font-display text-xl font-bold">{title}</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm" aria-label="Close">
                  ✕
                </Button>
              </Dialog.Close>
            </header>
            <div className="overflow-auto px-6 py-5 max-md:px-4">
              {description ? (
                <Dialog.Description className="mb-4 text-sm text-text-muted">
                  {description}
                </Dialog.Description>
              ) : null}
              {children}
            </div>
            {footer ? (
              <footer className="flex flex-wrap justify-end gap-2.5 border-t border-border px-6 py-4 max-md:px-4">
                {footer}
              </footer>
            ) : null}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => {
          setCopied((c) => (c === key ? null : c));
        }, 2000);
      },
      () => {
        setCopied(null);
      },
    );
  };
  return [copied, copy];
}

export function ShareDialog({
  open,
  onOpenChange,
  code,
  here,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  here: number;
}) {
  const link = `${window.location.origin}/r/${code}`;
  const [copied, copy] = useCopy();
  const [big, setBig] = useState(false);
  return (
    <>
      <DialogShell open={open} onOpenChange={onOpenChange} title="Invite your team">
        <div className="mb-5 flex items-center gap-4 max-md:flex-col">
          <QrCode text={link} label={`QR code for ${link}`} size={152} />
          <div className="text-sm">
            <p className="font-semibold">Scan to join</p>
            <p className="mt-1 text-text-muted">
              Point a phone camera at the code: it opens this room.
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => {
                setBig(true);
              }}
              data-testid="join-screen-open"
            >
              Show on a big screen
            </Button>
          </div>
        </div>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="share-link">
          Room link
        </label>
        <div className="flex items-center gap-2">
          <input
            id="share-link"
            readOnly
            value={link}
            onFocus={(e) => {
              e.currentTarget.select();
            }}
            className="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 font-mono text-[13px] text-text"
          />
          <Button
            variant="primary"
            onClick={() => {
              copy('link', link);
            }}
          >
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <p className="mt-5 mb-1.5 text-sm font-semibold">Or share the code</p>
        <p
          className="rounded-md bg-surface-2 p-[18px] text-center font-mono text-[28px] leading-none font-semibold tracking-[.12em]"
          data-testid="share-code"
        >
          {formatRoomCode(code)}
        </p>
        <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
          <span>Up to 16 people · {here} here now</span>
          <Button
            size="sm"
            onClick={() => {
              copy('code', code);
            }}
          >
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </Button>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Anyone with the link or code can join until the host locks the room. Your model key is
          never shared.
        </p>
        <p className="sr-only" aria-live="polite">
          {copied ? `${copied === 'link' ? 'Link' : 'Code'} copied` : ''}
        </p>
      </DialogShell>
      <JoinScreen open={big} onOpenChange={setBig} code={code} link={link} />
    </>
  );
}

/** The join screen for a projector or a shared screen: a big QR code and the room code. */
export function JoinScreen({
  open,
  onOpenChange,
  code,
  link,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  link: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6 overflow-auto bg-bg p-6 text-center text-text"
          aria-describedby={undefined}
          data-testid="join-screen"
        >
          <Dialog.Title className="font-display text-[clamp(22px,3.2vw,40px)] font-bold">
            Join the room
          </Dialog.Title>
          <QrCode
            text={link}
            label={`QR code for ${link}`}
            size={Math.min(420, Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.5))}
          />
          <p className="font-mono text-[clamp(36px,7vw,88px)] leading-none font-semibold tracking-[.12em]">
            {formatRoomCode(code)}
          </p>
          <p className="text-[clamp(14px,1.6vw,20px)] text-text-muted">
            Scan the code, or open {window.location.host} and type the code under Join.
          </p>
          <Dialog.Close asChild>
            <Button>Close</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function NameField({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  return (
    <input
      id={id}
      value={value}
      maxLength={24}
      autoComplete="nickname"
      aria-invalid={invalid ? true : undefined}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className={cx(
        'h-11 w-full rounded-xl border bg-surface px-3.5 text-base text-text',
        invalid ? 'border-danger' : 'border-border-strong',
      )}
    />
  );
}

export function RenameDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string;
  onSave: (name: string) => boolean;
}) {
  const [value, setValue] = useState(current);
  const [invalid, setInvalid] = useState(false);
  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (o) setValue(current);
        onOpenChange(o);
      }}
      title="Change your name"
      description="Shown next to your cursor. 1-24 characters."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const ok = onSave(value);
          setInvalid(!ok);
          if (ok) onOpenChange(false);
        }}
      >
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="rename">
          Your display name
        </label>
        <NameField id="rename" value={value} onChange={setValue} invalid={invalid} />
        {invalid ? <p className="mt-1.5 text-xs text-danger">Type at least one letter.</p> : null}
        <div className="mt-5 flex justify-end gap-2.5">
          <Dialog.Close asChild>
            <Button>Cancel</Button>
          </Dialog.Close>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
