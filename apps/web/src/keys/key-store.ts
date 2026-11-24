/**
 * Model keys for "your own key" (ADR-003, R10). A key lives only in this browser:
 *
 * - remembered: IndexedDB database "promptalong:keys", encrypted with AES-GCM under a CryptoKey that
 *   is generated on this device and stored non-extractable (it can be used, never read back). This
 *   protects against casual disk reads, not against code running on the page.
 * - "forget when I close this tab": kept in memory only.
 *
 * Keys never go into the room document, URLs, localStorage, logs, analytics, error reports or exports.
 * The only way out is the Authorization header of a request to the provider the person picked.
 */
const DB_NAME = 'promptalong:keys';
const KEYS = 'keys';
const DEVICE = 'device';
const DEVICE_KEY_ID = 'aes-gcm';

interface StoredKey {
  iv: Uint8Array;
  data: ArrayBuffer;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

export class KeyStore {
  private db: Promise<IDBDatabase> | null = null;
  private readonly memory = new Map<string, string>();
  private readonly remembered = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private loaded: Promise<void> | null = null;
  private readonly dbName: string;

  constructor(dbName = DB_NAME) {
    this.dbName = dbName;
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(KEYS);
        req.result.createObjectStore(DEVICE);
      };
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        reject(req.error ?? new Error('IndexedDB unavailable'));
      };
    });
    return this.db;
  }

  private async deviceKey(): Promise<CryptoKey> {
    const db = await this.open();
    const existing = (await request(
      db.transaction(DEVICE).objectStore(DEVICE).get(DEVICE_KEY_ID),
    )) as CryptoKey | undefined;
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const tx = db.transaction(DEVICE, 'readwrite');
    await request(tx.objectStore(DEVICE).put(key, DEVICE_KEY_ID));
    return key;
  }

  /** Which endpoints have a remembered key (names only, never values). */
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const db = await this.open();
        const names = await request(db.transaction(KEYS).objectStore(KEYS).getAllKeys());
        for (const n of names) if (typeof n === 'string') this.remembered.add(n);
      } catch {
        // private mode without IndexedDB: memory only
      }
      this.emit();
    })();
    return this.loaded;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    void this.load();
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** true if this browser has a key for the endpoint (synchronous, for rendering). */
  has(endpoint: string): boolean {
    return this.memory.has(endpoint) || this.remembered.has(endpoint);
  }

  isRemembered(endpoint: string): boolean {
    return this.remembered.has(endpoint);
  }

  async ready(): Promise<void> {
    await this.load();
  }

  async get(endpoint: string): Promise<string | null> {
    const inMemory = this.memory.get(endpoint);
    if (inMemory) return inMemory;
    await this.load();
    if (!this.remembered.has(endpoint)) return null;
    try {
      const db = await this.open();
      const stored = (await request(db.transaction(KEYS).objectStore(KEYS).get(endpoint))) as
        StoredKey | undefined;
      if (!stored) return null;
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: stored.iv as Uint8Array<ArrayBuffer> },
        await this.deviceKey(),
        stored.data,
      );
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }

  /** Saves a key. remember=false keeps it in memory for this tab only. */
  async set(endpoint: string, key: string, remember: boolean): Promise<void> {
    const value = key.trim();
    if (!value) return;
    await this.forget(endpoint, false);
    if (remember) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        await this.deviceKey(),
        new TextEncoder().encode(value),
      );
      const db = await this.open();
      await request(
        db
          .transaction(KEYS, 'readwrite')
          .objectStore(KEYS)
          .put({ iv, data } satisfies StoredKey, endpoint),
      );
      this.remembered.add(endpoint);
    } else {
      this.memory.set(endpoint, value);
    }
    this.emit();
  }

  async forget(endpoint: string, notify = true): Promise<void> {
    this.memory.delete(endpoint);
    if (this.remembered.has(endpoint)) {
      try {
        const db = await this.open();
        await request(db.transaction(KEYS, 'readwrite').objectStore(KEYS).delete(endpoint));
      } catch {
        // nothing stored
      }
      this.remembered.delete(endpoint);
    }
    if (notify) this.emit();
  }
}

export const keyStore = new KeyStore();
