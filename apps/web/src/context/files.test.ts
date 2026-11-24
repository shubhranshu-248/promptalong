import { CONTEXT_MAX_BYTES } from '@promptalong/core';
import { formatBytes, readContextFile } from './files';

function file(name: string, content: string | Uint8Array) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const copy = new ArrayBuffer(bytes.length);
  new Uint8Array(copy).set(bytes);
  return { name, size: bytes.length, arrayBuffer: () => Promise.resolve(copy) };
}

describe('context files', () => {
  it('reads .txt and .md as UTF-8, without the byte-order mark and with plain new lines', async () => {
    const bom = String.fromCharCode(0xfeff);
    expect(
      await readContextFile(file('judging-criteria.txt', `${bom}1. Problem\r\n2. Demo\r\n`)),
    ).toEqual({
      ok: true,
      title: 'judging-criteria.txt',
      text: '1. Problem\n2. Demo',
    });
    expect((await readContextFile(file('Notes.MD', '# नोट्स'))).ok).toBe(true);
  });

  it('refuses other file types, files over 200 KB, binary data and empty files', async () => {
    expect(await readContextFile(file('slides.pdf', 'x'))).toMatchObject({
      ok: false,
      problem: 'type',
    });
    expect(
      await readContextFile(file('big.txt', 'a'.repeat(CONTEXT_MAX_BYTES + 10))),
    ).toMatchObject({
      ok: false,
      problem: 'too-large',
    });
    expect(
      await readContextFile(
        file('photo.txt', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])),
      ),
    ).toMatchObject({ ok: false, problem: 'not-text' });
    expect(
      await readContextFile(file('zero.txt', new Uint8Array([0x61, 0x00, 0x62]))),
    ).toMatchObject({
      ok: false,
      problem: 'not-text',
    });
    expect(await readContextFile(file('blank.md', ' \n\n'))).toMatchObject({
      ok: false,
      problem: 'empty',
    });
    const exact = await readContextFile(file('fits.txt', 'a'.repeat(CONTEXT_MAX_BYTES)));
    expect(exact.ok).toBe(true);
  });

  it('formats sizes', () => {
    expect(formatBytes(412)).toBe('412 B');
    expect(formatBytes(1638)).toBe('1.6 KB');
    expect(formatBytes(204_800)).toBe('200 KB');
  });
});
