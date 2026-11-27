import { PACKED_MAGIC, gunzip, gzip, packState, unpackState } from './index';

const text = (n: number) =>
  new TextEncoder().encode('Lost and found on campus, week by week. '.repeat(Math.ceil(n / 40)));

describe('saved copies are compressed', () => {
  it('round-trips and shrinks ordinary text several times', async () => {
    const state = text(200_000);
    const packed = await packState(state);
    expect([...packed.subarray(0, 4)]).toEqual([...PACKED_MAGIC]);
    expect(packed.length).toBeLessThan(state.length / 5);
    expect(await unpackState(packed)).toEqual(state);
  });

  it('copies saved before compression load unchanged', async () => {
    const old = new Uint8Array([1, 2, 3, 0x1f, 0x8b, 9]);
    expect(await unpackState(old)).toEqual(old);
  });

  it('data that does not shrink is stored as it is', async () => {
    const noise = new Uint8Array(4096);
    crypto.getRandomValues(noise);
    expect(await packState(noise)).toEqual(noise);
    expect(await packState(new Uint8Array([7, 7]))).toEqual(new Uint8Array([7, 7]));
  });

  it('gzip and gunzip agree', async () => {
    const data = text(5000);
    expect(await gunzip(await gzip(data))).toEqual(data);
  });
});
