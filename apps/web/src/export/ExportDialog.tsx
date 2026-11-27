import { exportFileName, exportJson, exportMarkdown } from '@promptalong/core';
import { Button, cx } from '@promptalong/ui';
import { useId, useMemo, useState } from 'react';
import { DialogShell } from '../room/dialogs';
import type { RoomSession, RoomSnapshot } from '../room/session';
import type { SessionConn, SessionSnapshot } from '../room/session-conn';

type Format = 'md' | 'json';
type Range = 'session' | 'room';

const PREVIEW_CHARS = 2400;

/** Export the conversation as Markdown or JSON. Built here, in the browser. */
export default function ExportDialog({
  open,
  onOpenChange,
  session,
  snap,
  conn,
  ss,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: RoomSession;
  snap: RoomSnapshot;
  conn: SessionConn;
  ss: SessionSnapshot;
}) {
  const [range, setRange] = useState<Range>('session');
  const several = snap.sessions.length > 1;
  const current = snap.sessions.find((s) => s.id === conn.id);
  const ids = { context: useId(), authors: useId() };
  const [format, setFormat] = useState<Format>('md');
  const [includeContext, setIncludeContext] = useState(true);
  const [includeAuthors, setIncludeAuthors] = useState(true);
  const [copied, setCopied] = useState(false);
  // one timestamp per time the dialog is opened, so preview, copy and download are the same text
  const [exportedAt, setExportedAt] = useState(() => Date.now());

  const text = useMemo(() => {
    if (!open) return '';
    const options = { includeContext, includeAuthors, code: session.code, exportedAt };
    const sessions =
      range === 'room' && several
        ? snap.sessions.flatMap((s) => {
            const c = session.conn(s.id);
            return c ? [{ name: s.name, doc: c.doc }] : [];
          })
        : [{ name: several ? (current?.name ?? 'Session') : null, doc: conn.doc }];
    const source = { room: session.doc, sessions };
    return format === 'md' ? exportMarkdown(source, options) : exportJson(source, options);
    // (the turns and context change when the room does: export what is there now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    range,
    includeContext,
    includeAuthors,
    format,
    exportedAt,
    session,
    conn,
    ss.turns,
    ss.context,
    snap.context,
    snap.sessions,
  ]);
  const base =
    range === 'session' && several && current
      ? `${snap.settings?.name ?? 'room'} ${current.name}`
      : (snap.settings?.name ?? 'room');
  const fileName = exportFileName(base, exportedAt, format);

  const download = () => {
    const blob = new Blob([text], {
      type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  const formats: { id: Format; title: string; body: string }[] = [
    {
      id: 'md',
      title: 'Markdown',
      body: 'Readable. Each turn lists who wrote the prompt and which model answered.',
    },
    {
      id: 'json',
      title: 'JSON',
      body: 'Full record: prompt segments with authors, context items, model, timestamps.',
    },
  ];

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (o) setExportedAt(Date.now());
        onOpenChange(o);
      }}
      title="Export conversation"
      description="Made in your browser from this room. Nothing is uploaded."
      wide
      footer={
        <>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(text).then(
                () => {
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                  }, 2000);
                },
                () => undefined,
              );
            }}
            data-testid="export-copy"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="primary" onClick={download} data-testid="export-download">
            Download .{format}
          </Button>
        </>
      }
    >
      {several ? (
        <fieldset className="mb-4">
          <legend className="mb-1.5 text-sm font-semibold">What to export</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {(
              [
                ['session', `This session (${current?.name ?? 'open now'})`],
                ['room', `The whole room (${String(snap.sessions.length)} sessions)`],
              ] as const
            ).map(([id, label]) => (
              <label key={id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="export-range"
                  value={id}
                  checked={range === id}
                  onChange={() => {
                    setRange(id);
                  }}
                  data-testid={`export-range-${id}`}
                  className="size-[18px] accent-[var(--c-accent)]"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Format</legend>
        <div className="grid gap-2.5 md:grid-cols-2">
          {formats.map((f) => (
            <label
              key={f.id}
              className={cx(
                'flex cursor-pointer gap-2.5 rounded-lg border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring',
                format === f.id ? 'border-2 border-accent p-[11px]' : 'border-border-strong',
              )}
            >
              <input
                type="radio"
                name="export-format"
                value={f.id}
                checked={format === f.id}
                onChange={() => {
                  setFormat(f.id);
                }}
                className="mt-0.5 size-[18px] accent-[var(--c-accent)]"
              />
              <span>
                <b className="block text-sm">{f.title}</b>
                <span className="mt-0.5 block text-xs leading-snug text-text-muted">{f.body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2" htmlFor={ids.context}>
          <input
            id={ids.context}
            type="checkbox"
            checked={includeContext}
            onChange={(e) => {
              setIncludeContext(e.target.checked);
            }}
            className="size-[18px] accent-[var(--c-accent)]"
          />
          Include context items
        </label>
        <label className="flex items-center gap-2" htmlFor={ids.authors}>
          <input
            id={ids.authors}
            type="checkbox"
            checked={includeAuthors}
            onChange={(e) => {
              setIncludeAuthors(e.target.checked);
            }}
            className="size-[18px] accent-[var(--c-accent)]"
          />
          Include author names
        </label>
      </div>

      <p className="mt-4 mb-1.5 text-sm font-semibold">Preview</p>
      <pre
        className="max-h-[220px] overflow-auto rounded-md border border-border bg-code-bg p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
        tabIndex={0}
        aria-label="Export preview"
        data-testid="export-preview"
        data-length={text.length}
      >
        {text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n…` : text}
      </pre>
      <p className="mt-2 text-xs text-text-muted">
        {fileName} · {text.length.toLocaleString('en-US')} characters. Model keys are never included
        in an export.
      </p>
    </DialogShell>
  );
}
