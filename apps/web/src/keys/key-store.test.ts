import 'fake-indexeddb/auto';
import { KeyStore } from './key-store';

const CANARY = 'sk-test-PA-canary-123';

/** Every value stored in the database, as text, to prove the key is not there in plain form. */
async function rawDump(name: string): Promise<string> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => {
      resolve(r.result);
    };
    r.onerror = () => {
      reject(new Error('open'));
    };
  });
  const out: string[] = [];
  for (const store of Array.from(db.objectStoreNames)) {
    const values = await new Promise<unknown[]>((resolve) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => {
        resolve(r.result);
      };
    });
    for (const v of values) {
      if (typeof v === 'object' && v && 'data' in v) {
        out.push(new TextDecoder().decode((v as { data: ArrayBuffer }).data));
      } else out.push(JSON.stringify(v));
    }
  }
  db.close();
  return out.join('\n');
}

let n = 0;
const fresh = () => {
  n += 1;
  return `test-keys-${String(n)}`;
};

describe('KeyStore', () => {
  it('remembers a key encrypted at rest and reads it back', async () => {
    const name = fresh();
    const store = new KeyStore(name);
    await store.set('openrouter', ` ${CANARY} `, true);
    expect(await store.get('openrouter')).toBe(CANARY);
    expect(store.has('openrouter')).toBe(true);
    expect(store.isRemembered('openrouter')).toBe(true);
    expect(await rawDump(name)).not.toContain(CANARY);
    // a new page load (new instance) finds it
    const again = new KeyStore(name);
    await again.ready();
    expect(again.has('openrouter')).toBe(true);
    expect(await again.get('openrouter')).toBe(CANARY);
  });

  it('"forget when I close this tab" keeps it in memory only', async () => {
    const name = fresh();
    const store = new KeyStore(name);
    await store.set('groq', CANARY, false);
    expect(await store.get('groq')).toBe(CANARY);
    expect(store.isRemembered('groq')).toBe(false);
    const next = new KeyStore(name);
    await next.ready();
    expect(await next.get('groq')).toBeNull();
    expect(await rawDump(name)).not.toContain(CANARY);
  });

  it('forget removes it everywhere; switching to tab-only removes the stored copy', async () => {
    const name = fresh();
    const store = new KeyStore(name);
    await store.set('google', CANARY, true);
    await store.set('google', 'second-key-value', false);
    expect(store.isRemembered('google')).toBe(false);
    await store.forget('google');
    expect(await store.get('google')).toBeNull();
    expect(store.has('google')).toBe(false);
  });

  it('never writes keys to localStorage or sessionStorage', async () => {
    const store = new KeyStore(fresh());
    await store.set('openai', CANARY, true);
    await store.set('groq', CANARY, false);
    const dump = (st: Storage) =>
      Array.from({ length: st.length }, (_, i) => {
        const k = st.key(i) ?? '';
        return `${k}=${st.getItem(k) ?? ''}`;
      }).join('\n');
    const all = dump(localStorage) + dump(sessionStorage);
    expect(all).not.toContain(CANARY);
  });
});
