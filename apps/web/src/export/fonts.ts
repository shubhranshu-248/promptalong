import devaBold from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff?url';
import deva from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff?url';
import regular from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import bold from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import regularExt from '@fontsource/inter/files/inter-latin-ext-400-normal.woff?url';
import boldExt from '@fontsource/inter/files/inter-latin-ext-700-normal.woff?url';
import mono from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url';
import display from '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff?url';
import type { FontLoader, FontName } from './pdf';

const URLS: Record<FontName, string> = {
  regular,
  regularExt,
  bold,
  boldExt,
  deva,
  devaBold,
  mono,
  display,
};

/** The site's own font files (same origin, cached by the browser). */
export const loadFont: FontLoader = async (name) => {
  const res = await fetch(URLS[name]);
  if (!res.ok) throw new Error(`The ${name} font could not be loaded.`);
  return new Uint8Array(await res.arrayBuffer());
};
