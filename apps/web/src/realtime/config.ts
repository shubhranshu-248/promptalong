export type RealtimeMode = 'supabase' | 'relay' | 'none';

export interface RealtimeConfig {
  mode: RealtimeMode;
  supabaseUrl?: string;
  supabaseKey?: string;
  relayUrl?: string;
}

interface Env {
  DEV?: boolean;
  VITE_REALTIME?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_RELAY_URL?: string;
}

/**
 * Which transport rooms use. Explicit VITE_REALTIME wins; otherwise Supabase when its URL and anon
 * key are set, the local relay in development, and "this device only" everywhere else.
 */
export function resolveRealtime(env: Env): RealtimeConfig {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  const relayEnv = env.VITE_RELAY_URL?.trim();
  let relayUrl = 'ws://localhost:8787';
  if (relayEnv) relayUrl = relayEnv;
  const supabase: RealtimeConfig | null =
    url && key ? { mode: 'supabase', supabaseUrl: url, supabaseKey: key } : null;
  switch (env.VITE_REALTIME) {
    case 'supabase':
      return supabase ?? { mode: 'none' };
    case 'relay':
      return { mode: 'relay', relayUrl };
    case 'none':
      return { mode: 'none' };
    default:
      if (supabase) return supabase;
      if (env.DEV) return { mode: 'relay', relayUrl };
      return { mode: 'none' };
  }
}

export const realtimeConfig: RealtimeConfig = resolveRealtime(import.meta.env);
