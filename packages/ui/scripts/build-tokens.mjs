// Regenerates src/styles/tokens.css from src/tokens/tokens.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { tokensToCss } from './tokens-to-css.mjs';

const root = new URL('../', import.meta.url);
const tokens = JSON.parse(readFileSync(new URL('src/tokens/tokens.json', root), 'utf8'));
writeFileSync(new URL('src/styles/tokens.css', root), tokensToCss(tokens));
console.log('tokens.css written');
