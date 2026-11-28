import {
  exportFileName,
  exportJson,
  exportMarkdown,
  exportModel,
  type ExportModel,
} from '@promptalong/core';
import { Button, cx } from '@promptalong/ui';
import { useId, useState } from 'react';
import { PrintView } from './PrintView';
import { DialogShell } from '../room/dialogs';
import type { RoomSession, RoomSnapshot } from '../room/session';
import type { SessionConn } from '../room/session-conn';

type Format = 'pdf' | 'md' | 'json';
type Range = 'session' | 'room' | 'each';

/** letters the PDF fonts do not have: emoji, Chinese, Japanese, Korean… (the print view has them) */
const NO_PDF_FONT = /[\p{Extended_Pictographic}\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const DEVANAGARI = /[\u0900-\u097f]/u;

function save(data: string | Uint8Array, name: string, type: string): void {
  // (a copy: Blob wants bytes on a plain ArrayBuffer)
  const part = typeof data === 'string' ? data : new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

const PREVIEW_CHARS = 2400;

/** Export the conversation as Markdown or JSON. Built here, in the browser. */
export default function ExportDialog({
  open,
  onOpenChange,
  session,
  snap,
  conn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: RoomSession;
  snap: RoomSnapshot;
  conn: SessionConn;
}) {
  const [range, setRange] = useState<Range>('session');
  const several = snap.sessions.length > 1;
  const current = snap.sessions.find((s) => s.id === conn.id);
  const ids = { context: useId(), authors: useId() };
  const [format, setFormat] = useState<Format>('pdf');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [printing, setPrinting] = useState<ExportModel | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [includeAuthors, setIncludeAuthors] = useState(true);
  const [copied, setCopied] = useState(false);
  // one timestamp per time the dialog is opened, so preview, copy and download are the same text
  const [exportedAt, setExportedAt] = useState(() => Date.now());

  const options = { includeContext, includeAuthors, code: session.code, exportedAt };
  const whole = range !== 'session' && several;
  const sourceOf = () => {
    const sessions = whole
      ? snap.sessions.flatMap((s) => {
          const c = session.conn(s.id);
          return c ? [{ name: s.name, doc: c.doc }] : [];
        })
      : [{ name: several ? (current?.name ?? 'Session') : null, doc: conn.doc }];
    return { room: session.doc, sessions };
  };
  // made while the dialog is open, from the room as it is now
  const text = open
    ? format === 'json'
      ? exportJson(sourceOf(), options)
      : exportMarkdown(sourceOf(), options)
    : '';
  const base =
    range === 'session' && several && current
      ? `${snap.settings?.name ?? 'room'} ${current.name}`
      : (snap.settings?.name ?? 'room');
  const fileName = exportFileName(
    base,
    exportedAt,
    format === 'pdf' && range === 'each' && whole ? 'zip' : format,
  );
  const hindi = format === 'pdf' && DEVANAGARI.test(text);
  const missing = format === 'pdf' && NO_PDF_FONT.test(text);

  const download = async () => {
    setProblem(null);
    if (format !== 'pdf') {
      save(
        text,
        fileName,
        format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
      );
      return;
    }
    setBusy(true);
    try {
      // the PDF code and fonts are loaded the first time someone makes a PDF
      const [{ buildPdf, buildSessionPdfs }, { loadFont }] = await Promise.all([
        import('./pdf'),
        import('./fonts'),
      ]);
      const model = exportModel(sourceOf(), options);
      if (range === 'each' && whole) {
        const { zipSync } = await import('fflate');
        const files = await buildSessionPdfs(model, loadFont);
        const used = new Set<string>();
        const entries: Record<string, Uint8Array> = {};
        for (const f of files) {
          let name = exportFileName(`${model.roomName} ${f.name}`, exportedAt, 'pdf');
          for (let n = 2; used.has(name); n++)
            name = name.replace(/(-\d+)?\.pdf$/u, `-${String(n)}.pdf`);
          used.add(name);
          entries[name] = f.bytes;
        }
        // PDFs are compressed already: stored as they are
        save(zipSync(entries, { level: 0 }), fileName, 'application/zip');
      } else {
        save(await buildPdf(model, loadFont), fileName, 'application/pdf');
      }
    } catch {
      setProblem('The PDF could not be made. Try the print view, or download Markdown.');
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    const model = exportModel(sourceOf(), options);
    onOpenChange(false);
    setPrinting(model);
  };

  const formats: { id: Format; title: string; body: string }[] = [
    {
      id: 'pdf',
      title: 'PDF',
      body: 'To read, print or hand in. Prompts with their writers, answers, context.',
    },
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
    <>
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
            <Button onClick={print} data-testid="export-print">
              Print view
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void download();
              }}
              data-testid="export-download"
            >
              {busy
                ? 'Making the PDF…'
                : format === 'pdf' && range === 'each' && whole
                  ? 'Download PDFs (.zip)'
                  : `Download .${format}`}
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
                  ['room', `The whole room (${String(snap.sessions.length)} sessions) in one file`],
                  ['each', 'One PDF per session (.zip)'],
                ] as const
              )
                .filter(([id]) => id !== 'each' || format === 'pdf')
                .map(([id, label]) => (
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
          <div className="grid gap-2.5 md:grid-cols-3">
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
                  <span className="mt-0.5 block text-xs leading-snug text-text-muted">
                    {f.body}
                  </span>
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
          {fileName} · {text.length.toLocaleString('en-US')} characters. Model keys are never
          included in an export.
        </p>
        {hindi ? (
          <p className="mt-2 text-xs text-text-muted" data-testid="export-hindi">
            Hindi text found: the PDF includes a Devanagari font for it.
          </p>
        ) : null}
        {missing ? (
          <p className="mt-2 text-xs text-warning-text" data-testid="export-missing">
            Some characters (emoji, Chinese, Japanese or Korean) are not in the PDF fonts and show
            as &quot;?&quot;. Print view keeps them: choose Save as PDF there.
          </p>
        ) : null}
        {problem ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {problem}
          </p>
        ) : null}
      </DialogShell>
      {printing ? (
        <PrintView
          model={printing}
          onDone={() => {
            setPrinting(null);
          }}
        />
      ) : null}
    </>
  );
}
