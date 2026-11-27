// @vitest-environment node
import { readFileSync } from 'node:fs';
import { tokensToCss } from '../scripts/tokens-to-css.mjs';
import tokens from './tokens/tokens.json';

describe('tokens', () => {
  it('tokens.css is in sync with tokens.json (run `pnpm --filter @promptalong/ui tokens`)', () => {
    const css = readFileSync(new URL('./styles/tokens.css', import.meta.url), 'utf8');
    expect(css).toBe(tokensToCss(tokens));
  });

  it('defines sixteen presence colours, each readable in both themes', () => {
    const slots = tokens.color.presence.slots;
    expect(slots).toHaveLength(16);
    expect(new Set(slots.map((s) => s.value)).size).toBe(16);
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const l = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * (l[0] ?? 0) + 0.7152 * (l[1] ?? 0) + 0.0722 * (l[2] ?? 0);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    const { light, dark } = tokens.color;
    const backgrounds = [light.bg, light.surface, dark.bg, dark.surface, dark['surface-2']];
    for (const s of slots) {
      for (const bg of backgrounds)
        expect(ratio(s.value, bg), `${s.id} on ${bg}`).toBeGreaterThanOrEqual(3);
      expect(ratio(s.value, s.label), `${s.id} label`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
