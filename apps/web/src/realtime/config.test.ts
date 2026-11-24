import { resolveRealtime } from './config';

describe('resolveRealtime', () => {
  const sb = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' };

  it('uses Supabase when it is configured', () => {
    expect(resolveRealtime(sb).mode).toBe('supabase');
  });

  it('uses the local relay in development', () => {
    expect(resolveRealtime({ DEV: true })).toEqual({
      mode: 'relay',
      relayUrl: 'ws://localhost:8787',
    });
  });

  it('is device-only in a production build without Supabase', () => {
    expect(resolveRealtime({}).mode).toBe('none');
  });

  it('respects an explicit choice', () => {
    expect(resolveRealtime({ ...sb, VITE_REALTIME: 'relay', VITE_RELAY_URL: 'ws://h:1' })).toEqual({
      mode: 'relay',
      relayUrl: 'ws://h:1',
    });
    expect(resolveRealtime({ ...sb, VITE_REALTIME: 'none' }).mode).toBe('none');
    expect(resolveRealtime({ VITE_REALTIME: 'supabase' }).mode).toBe('none');
  });
});
