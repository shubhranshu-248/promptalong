// fontkit 2 ships no types; only what the PDF export uses is declared here.
declare module 'fontkit' {
  export function create(bytes: Uint8Array): unknown;
}
