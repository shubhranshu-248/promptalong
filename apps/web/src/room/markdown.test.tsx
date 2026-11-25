import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';
import { parseInline, parseMarkdown, safeHref } from './markdown';

describe('parseMarkdown', () => {
  it('reads paragraphs, headings, lists, quotes, rules and code', () => {
    const blocks = parseMarkdown(
      [
        '## Plan',
        'First line',
        'second line',
        '',
        '- one',
        '- two',
        '  more of two',
        '',
        '1. first',
        '2) second',
        '',
        '> quoted',
        '---',
        '```ts',
        'const a = 1;',
        '```',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'list', 'list', 'quote', 'hr', 'code']);
    expect(blocks[1]).toEqual({ t: 'p', c: [{ t: 'text', v: 'First line\nsecond line' }] });
    expect(blocks[2]).toMatchObject({
      ordered: false,
      items: [
        { marker: '•', c: [{ t: 'text', v: 'one' }] },
        { marker: '•', c: [{ t: 'text', v: 'two\nmore of two' }] },
      ],
    });
    expect(blocks[3]).toMatchObject({ ordered: true, items: [{ marker: '1.' }, { marker: '2)' }] });
    expect(blocks[6]).toEqual({ t: 'code', lang: 'ts', v: 'const a = 1;' });
  });

  it('reads a table only once its separator row has arrived', () => {
    expect(parseMarkdown('| A | B |').map((b) => b.t)).toEqual(['p']);
    const [table] = parseMarkdown('| A | B |\n|:--|--:|\n| 1 | 2 |\n| x \\| y |');
    expect(table).toMatchObject({
      t: 'table',
      align: ['left', 'right'],
      head: [[{ t: 'text', v: 'A' }], [{ t: 'text', v: 'B' }]],
      rows: [
        [[{ t: 'text', v: '1' }], [{ t: 'text', v: '2' }]],
        [[{ t: 'text', v: 'x | y' }], []],
      ],
    });
  });

  it('keeps an unclosed code fence open while the answer streams', () => {
    expect(parseMarkdown('Look:\n```\nline 1\nline')).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'Look:' }] },
      { t: 'code', lang: '', v: 'line 1\nline' },
    ]);
  });
});

describe('parseInline', () => {
  it('reads code, bold, italic and links', () => {
    expect(parseInline('a `x*y` **bold *both*** _it_ [site](https://example.com)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'code', v: 'x*y' },
      { t: 'text', v: ' ' },
      {
        t: 'strong',
        c: [
          { t: 'text', v: 'bold ' },
          { t: 'em', c: [{ t: 'text', v: 'both' }] },
        ],
      },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'it' }] },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://example.com', c: [{ t: 'text', v: 'site' }] },
    ]);
  });

  it('leaves half-written and in-word markers as text', () => {
    expect(parseInline('**Open')).toEqual([{ t: 'text', v: '**Open' }]);
    expect(parseInline('snake_case_name and 2 * 3 * 4')).toEqual([
      { t: 'text', v: 'snake_case_name and 2 * 3 * 4' },
    ]);
  });

  it('never makes unsafe links', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(parseInline('[x](javascript:alert(1))')[0]).toEqual({
      t: 'text',
      v: '[x](javascript:alert(1))',
    });
  });
});

describe('<Markdown>', () => {
  it('renders elements, not HTML from the answer', () => {
    const { container } = render(
      <Markdown text={'<img src=x onerror=alert(1)> **hi**\n\n| a |\n|---|\n| 1 |'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('hi').tagName).toBe('STRONG');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('puts the tail after the last word', () => {
    const { container } = render(
      <Markdown text={'one\n\n- a\n- b'} tail={<span data-testid="tail" />} />,
    );
    const tail = screen.getByTestId('tail');
    expect(tail.parentElement?.textContent).toBe('b');
    expect(container.querySelectorAll('[data-testid="tail"]')).toHaveLength(1);
  });

  it('opens links in a new tab without passing the page along', () => {
    render(<Markdown text="see [docs](https://example.com/a)" />);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
