// Turns tokens.json into CSS custom properties. Used by build-tokens.mjs and by the sync test.

/** @param {Record<string, unknown>} t */
export function tokensToCss(t) {
  const lines = [
    '/* PromptAlong design tokens - generated from tokens.json, do not edit by hand */',
  ];
  const block = (selector, entries) => {
    lines.push(`${selector} {`);
    for (const [k, v] of entries) lines.push(`  --${k}: ${v};`);
    lines.push('}');
  };

  const light = [];
  for (const [k, v] of Object.entries(t.color.light)) light.push([`c-${k}`, v]);
  for (const slot of t.color.presence.slots) {
    const n = slot.id.slice(1);
    light.push([`p-${n}`, slot.value], [`p-${n}-label`, slot.label]);
  }
  for (const [k, v] of Object.entries(t.color.brand)) light.push([`brand-${k}`, v]);
  for (const [k, v] of Object.entries(t.font.family)) light.push([`font-${k}`, v]);
  for (const [k, v] of Object.entries(t.font.size)) light.push([`fs-${k}`, v]);
  for (const [k, v] of Object.entries(t.font['line-height'])) light.push([`lh-${k}`, String(v)]);
  for (const [k, v] of Object.entries(t.space)) light.push([`s-${k}`, v]);
  for (const [k, v] of Object.entries(t.radius)) light.push([`r-${k}`, v]);
  for (const [k, v] of Object.entries(t.shadow.light)) light.push([`sh-${k}`, v]);
  for (const [k, v] of Object.entries(t.size)) {
    if (!k.startsWith('breakpoint')) light.push([k, v]);
  }
  for (const [k, v] of Object.entries(t.motion.duration)) light.push([`d-${k}`, v]);
  for (const [k, v] of Object.entries(t.motion.easing)) light.push([`e-${k}`, v]);
  for (const [k, v] of Object.entries(t.z)) light.push([`z-${k}`, String(v)]);
  light.push(['selection-alpha', String(t.color.presence['selection-alpha'])]);
  block(':root', light);

  const dark = [];
  for (const [k, v] of Object.entries(t.color.dark)) dark.push([`c-${k}`, v]);
  for (const [k, v] of Object.entries(t.shadow.dark)) dark.push([`sh-${k}`, v]);
  block('[data-theme="dark"]', dark);

  const rm = t.motion['reduced-motion'];
  lines.push(`@media ${rm.media} {`);
  lines.push('  :root {');
  for (const k of Object.keys(t.motion.duration))
    lines.push(`    --d-${k}: ${rm['duration-override']};`);
  lines.push('  }');
  lines.push('}');
  return lines.join('\n') + '\n';
}
