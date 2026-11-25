import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const MIGRATIONS = here('../../../supabase/migrations/');

export type Json = Record<string, unknown>;

/**
 * An in-process Postgres with the project's migrations applied, so the row-level security rules
 * and SQL functions are tested for real, in CI, without Docker or a hosted project.
 */
export class TestDb {
  private codes = 0;

  private constructor(private readonly db: PGlite) {}

  static async create(): Promise<TestDb> {
    const db = new PGlite();
    await db.exec(readFileSync(here('./shim.sql'), 'utf8'));
    for (const file of readdirSync(MIGRATIONS).sort()) {
      if (file.endsWith('.sql')) await db.exec(readFileSync(MIGRATIONS + file, 'utf8'));
    }
    return new TestDb(db);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  /** A new signed-in (anonymous) person. */
  async user(): Promise<string> {
    const rows = await this.admin<{ id: string }>(
      'insert into auth.users default values returning id',
    );
    return rows[0]?.id ?? '';
  }

  /** A valid room code nobody has used yet. */
  code(): string {
    const alphabet = '123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let n = (this.codes += 1);
    let out = '';
    for (let i = 0; i < 6; i++) {
      out = alphabet.charAt(n % alphabet.length) + out;
      n = Math.floor(n / alphabet.length);
    }
    return out;
  }

  /** Runs SQL as the database owner (no row-level security): test set-up and time travel. */
  async admin<T = Json>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.db.query<T>(sql, params)).rows;
  }

  /**
   * Runs SQL the way the API does for a signed-in person (role `authenticated`, their id in the
   * JWT claims), or for a visitor with only the public key when `uid` is null (role `anon`).
   */
  async as<T = Json>(
    uid: string | null,
    sql: string,
    params: unknown[] = [],
    topic = '',
  ): Promise<T[]> {
    const claims = uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' };
    await this.db.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify(claims),
    ]);
    await this.db.query(`select set_config('realtime.topic', $1, false)`, [topic]);
    await this.db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
    try {
      return (await this.db.query<T>(sql, params)).rows;
    } finally {
      await this.db.exec('reset role');
    }
  }

  /** Calls one of the API functions as a person and returns its JSON answer. */
  async call(uid: string | null, fn: string, ...args: unknown[]): Promise<Json> {
    const list = args.map((_, i) => `$${String(i + 1)}`).join(', ');
    const rows = await this.as<{ r: Json }>(uid, `select public.${fn}(${list}) as r`, args);
    return rows[0]?.r ?? {};
  }

  /** Creates a room and returns its id and code (throws when the call is refused). */
  async room(host: string, name = 'Hackathon pitch'): Promise<{ id: string; code: string }> {
    const code = this.code();
    const res = await this.call(host, 'create_room', code, name, 'Host');
    if (res.ok !== true) throw new Error(`create_room refused: ${JSON.stringify(res)}`);
    return { id: (res.room as { id: string }).id, code };
  }
}
