import { useEffect, useState } from 'react';

/**
 * A QR code for a link, drawn as one SVG path. Always dark on white with a quiet border, whatever
 * the theme, so every phone camera reads it. The encoder is loaded only when a code is shown.
 */
export function QrCode({
  text,
  size = 176,
  label,
}: {
  text: string;
  size?: number;
  label: string;
}) {
  const [path, setPath] = useState<{ d: string; n: number } | null>(null);
  useEffect(() => {
    let live = true;
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${String(c)} ${String(r)}h1v1h-1z`;
      }
      if (live) setPath({ d, n });
    });
    return () => {
      live = false;
    };
  }, [text]);
  const quiet = 4;
  const box = (path?.n ?? 25) + quiet * 2;
  return (
    <svg
      viewBox={`${String(-quiet)} ${String(-quiet)} ${String(box)} ${String(box)}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className="rounded-lg"
      shapeRendering="crispEdges"
      data-testid="qr-code"
      data-ready={path ? 'true' : 'false'}
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#FFFFFF" />
      {path ? <path d={path.d} fill="#111218" /> : null}
    </svg>
  );
}
