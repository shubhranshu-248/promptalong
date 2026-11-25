import { useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from './markdown';

function renderInline(nodes: readonly Inline[], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${String(i)}`;
    switch (n.t) {
      case 'text':
        return n.v;
      case 'code':
        return (
          <code key={k} className="rounded-sm bg-surface-2 px-1 py-px font-mono text-[0.9em]">
            {n.v}
          </code>
        );
      case 'strong':
        return <strong key={k}>{renderInline(n.c, `${k}.`)}</strong>;
      case 'em':
        return <em key={k}>{renderInline(n.c, `${k}.`)}</em>;
      case 'link':
        return (
          <a
            key={k}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent underline"
          >
            {renderInline(n.c, `${k}.`)}
          </a>
        );
    }
  });
}

const HEADING_CLASS = [
  'font-display text-xl font-bold',
  'font-display text-lg font-bold',
  'font-display text-base font-bold',
];

function renderBlock(b: Block, k: number, tail: ReactNode): ReactNode {
  switch (b.t) {
    case 'p':
      return (
        <p key={k} className="whitespace-pre-wrap">
          {renderInline(b.c)}
          {tail}
        </p>
      );
    case 'h': {
      const Tag = `h${String(Math.min(6, b.level + 2))}` as 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag key={k} className={HEADING_CLASS[Math.min(b.level, 3) - 1]}>
          {renderInline(b.c)}
          {tail}
        </Tag>
      );
    }
    case 'code':
      return (
        <pre
          key={k}
          className="overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-[13px] leading-normal"
          data-lang={b.lang || undefined}
        >
          <code>{b.v}</code>
          {tail}
        </pre>
      );
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return (
        // list-style none removes list semantics in some screen readers: role="list" keeps them
        <Tag key={k} role="list" className="flex list-none flex-col gap-1 p-0">
          {b.items.map((item, j) => (
            <li key={j} className="flex gap-2">
              <span className="flex-none tabular-nums text-text-muted">{item.marker}</span>
              <span className="min-w-0 whitespace-pre-wrap">
                {renderInline(item.c)}
                {j === b.items.length - 1 ? tail : null}
              </span>
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote
          key={k}
          className="border-l-[3px] border-border pl-3 whitespace-pre-wrap text-text-muted"
        >
          {renderInline(b.c)}
          {tail}
        </blockquote>
      );
    case 'table':
      return (
        <div key={k} className="overflow-x-auto">
          <table className="answer-table w-full border-collapse text-sm">
            <thead>
              <tr>
                {b.head.map((cell, j) => (
                  <th key={j} style={{ textAlign: b.align[j] ?? 'left' }}>
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ textAlign: b.align[j] ?? 'left' }}>
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {tail}
        </div>
      );
    case 'hr':
      return (
        <div key={k}>
          <hr className="border-border" />
          {tail}
        </div>
      );
  }
}

/**
 * A model answer as formatted text. `tail` (the streaming caret, "stopped") is placed at the end of
 * the last block, so it sits right after the last word instead of on a line of its own.
 */
export function Markdown({ text, tail }: { text: string; tail?: ReactNode }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  if (blocks.length === 0) return tail ? <p>{tail}</p> : null;
  return (
    <div className="answer-md flex flex-col gap-3">
      {blocks.map((b, k) => renderBlock(b, k, k === blocks.length - 1 ? tail : null))}
    </div>
  );
}
