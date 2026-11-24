export const DISPLAY_NAME_MAX = 24;

/**
 * Display names are 1-24 characters after trimming, with control characters removed and inner
 * whitespace collapsed. Returns null when nothing usable is left.
 */
export function cleanDisplayName(input: string): string | null {
  const cleaned = Array.from(
    input
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
    .slice(0, DISPLAY_NAME_MAX)
    .join('')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
