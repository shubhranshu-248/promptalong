import type { Transport } from '@promptalong/core';
import type { RealtimeConfig } from './config';
import { LocalOnlyTransport } from './local-transport';
import { RelayTransport } from './relay-transport';
import { SupabaseTransport } from './supabase-transport';

export { realtimeConfig, resolveRealtime, type RealtimeConfig, type RealtimeMode } from './config';

export function createTransport(config: RealtimeConfig, room: string): Transport {
  if (config.mode === 'supabase' && config.supabaseUrl && config.supabaseKey) {
    return new SupabaseTransport(config.supabaseUrl, config.supabaseKey, room);
  }
  if (config.mode === 'relay' && config.relayUrl) return new RelayTransport(config.relayUrl, room);
  return new LocalOnlyTransport();
}
