// @vitest-environment node
import { readFileSync } from 'node:fs';
import { tokensToCss } from '../scripts/tokens-to-css.mjs';
import tokens from './tokens/tokens.json';

describe('tokens', () => {
  it('tokens.css is in sync with tokens.json (run `pnpm --filter @promptalong/ui tokens`)', () => {
    const css = readFileSync(new URL('./styles/tokens.css', import.meta.url), 'utf8');
    expect(css).toBe(tokensToCss(tokens));
  });

  it('defines eight presence slots', () => {
    expect(tokens.color.presence.slots).toHaveLength(8);
  });
});
