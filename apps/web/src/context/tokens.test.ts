import { TokenStore, knownTokens, type Backend } from './tokens';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('TokenStore', () => {
  it('estimates until a count arrives, then tells subscribers', async () => {
    const calls: string[][] = [];
    const backend: Backend = (texts) => {
      calls.push(texts);
      return Promise.resolve(texts.map((t) => t.split(' ').length));
    };
    const store = new TokenStore(() => backend);
    let heard = 0;
    store.subscribe(() => heard++);

    expect(knownTokens(store, 'o200k', 'one two three four')).toEqual({
      tokens: 5,
      counted: false,
    });
    store.ensure('o200k', ['one two three four', 'one two three four', '', 'x']);
    store.ensure('o200k', ['one two three four']); // already asked: not sent twice
    await tick();
    expect(calls).toEqual([['one two three four', 'x']]);
    expect(heard).toBe(1);
    expect(knownTokens(store, 'o200k', 'one two three four')).toEqual({ tokens: 4, counted: true });
    expect(store.peek('o200k', '')).toBe(0);
    // another counting space has its own counts
    expect(store.peek('engine:m', 'one two three four')).toBeUndefined();
  });

  it('a counter that cannot start is not asked again: counts stay estimates', async () => {
    let calls = 0;
    const store = new TokenStore(() => () => {
      calls++;
      return Promise.reject(new Error('no worker'));
    });
    store.ensure('o200k', ['abc']);
    await tick();
    expect(store.works('o200k')).toBe(false);
    store.ensure('o200k', ['abc', 'def']);
    await tick();
    expect(calls).toBe(1);
    expect(knownTokens(store, 'o200k', 'abcdefgh')).toEqual({ tokens: 2, counted: false });
  });

  it('no backend at all (no Worker support) -> estimates', () => {
    const store = new TokenStore(() => null);
    store.ensure('o200k', ['abc']);
    expect(store.works('o200k')).toBe(false);
  });

  it('"not ready yet" (null) is asked again later', async () => {
    let ready = false;
    const store = new TokenStore(
      () => (texts) => Promise.resolve(ready ? texts.map(() => 7) : null),
    );
    store.ensure('engine:m', ['abc']);
    await tick();
    expect(store.peek('engine:m', 'abc')).toBeUndefined();
    expect(store.works('engine:m')).toBe(true);
    ready = true;
    store.ensure('engine:m', ['abc']);
    await tick();
    expect(store.peek('engine:m', 'abc')).toBe(7);
  });
});
