import type { ExportModel } from '@promptalong/core';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MadeWith } from '../components/MadeWith';
import { Markdown } from '../room/Markdown';
import { applyTheme, applyThemePreference } from '../theme';

/**
 * The print view: the export drawn as a page and handed to the browser's Print (where "Save as
 * PDF" is one choice). The device's fonts draw every script and emoji, so this is the fallback for
 * text the PDF fonts do not have. Only this view is printed; the rest of the page is hidden.
 */
export function PrintView({ model, onDone }: { model: ExportModel; onDone: () => void }) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    // paper is white: print in the light theme, then go back to the chosen one
    applyTheme('light');
    const finish = () => {
      applyThemePreference();
      done.current();
    };
    window.addEventListener('afterprint', finish);
    // after this view is on the page
    const timer = setTimeout(() => {
      window.print();
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
      applyThemePreference();
    };
  }, []);

  const turns = model.sessions.reduce((n, s) => n + s.turns.length, 0);
  const several = !(model.sessions.length === 1 && model.sessions[0]?.name === null);
  return createPortal(
    <div id="pa-print" className="bg-white text-[#111218]" data-testid="print-view">
      <h1 className="font-display text-[26px] font-bold">{model.roomName}</h1>
      <p className="mt-1 text-[12px] text-[#5c6170]">
        {[
          `Room ${model.code}`,
          several ? `${String(model.sessions.length)} sessions` : '',
          `${String(turns)} ${turns === 1 ? 'turn' : 'turns'}`,
          `exported ${new Date(model.exportedAt).toISOString().slice(0, 10)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {model.instructions ? (
        <p className="mt-2 text-[13px]">Room instructions: {model.instructions}</p>
      ) : null}
      {model.context.length > 0 ? (
        <section className="mt-5">
          <h2 className="text-[15px] font-bold">Room context</h2>
          {model.context.map((c) => (
            <div key={c.title} className="mt-2">
              <p className="text-[12px] font-semibold text-[#5c6170]">
                {c.title} · {c.owner} · {c.kind}
              </p>
              <p className="border-l-2 border-[#dcdee3] pl-3 text-[12px] whitespace-pre-wrap">
                {c.text}
              </p>
            </div>
          ))}
        </section>
      ) : null}
      {model.sessions.map((s, i) => (
        <section
          key={`${s.name ?? ''}${String(i)}`}
          className={i > 0 ? 'pa-print-break mt-8' : 'mt-6'}
        >
          {s.name !== null ? (
            <h2 className="font-display text-[20px] font-bold">{s.name}</h2>
          ) : null}
          {s.instructions ? (
            <p className="text-[12px] text-[#5c6170]">Session instructions: {s.instructions}</p>
          ) : null}
          {s.turns.map((t) => (
            <article key={t.label} className="pa-print-turn mt-5">
              <p className="text-[12px] font-semibold text-[#5c6170]">
                {t.comparison
                  ? `${t.label} · the same prompt to ${t.model}`
                  : `${t.label} · ${t.authors.length > 1 ? `written by ${t.authors.join(', ')}, ` : ''}sent by ${t.sentBy}`}
              </p>
              {t.comparison ? null : (
                <p className="mt-1 border-l-2 border-[#d4382b] pl-3 text-[14px] whitespace-pre-wrap">
                  {t.prompt}
                </p>
              )}
              <div className="mt-2 text-[14px]">
                <Markdown text={t.answer || '(no answer)'} />
              </div>
              <p className="mt-1 text-[11px] text-[#5c6170]">
                {[t.model, t.status].filter(Boolean).join(' · ')}
              </p>
            </article>
          ))}
          {s.context.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-[14px] font-bold">
                {s.name === null ? 'Context items' : 'Session context'}
              </h3>
              {s.context.map((c) => (
                <p key={c.title} className="mt-1 text-[12px] whitespace-pre-wrap">
                  <b>{c.title}</b> · {c.owner}: {c.text}
                </p>
              ))}
            </div>
          ) : null}
        </section>
      ))}
      <MadeWith className="mt-10 text-[11px] !text-[#5c6170]" testId="print-credit" />
    </div>,
    document.body,
  );
}
