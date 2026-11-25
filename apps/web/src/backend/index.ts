import type { RealtimeConfig } from '../realtime/config';
import { realtimeConfig } from '../realtime/config';
import { LocalBackend } from './local-backend';
import { RelayBackend } from './relay-backend';
import { SupabaseBackend } from './supabase-backend';
import type { RoomBackend } from './types';

export type {
  AccessFailure,
  ActionFailure,
  ActionResult,
  JoinResult,
  RoomBackend,
  RoomInfo,
  TouchResult,
} from './types';

export function createBackend(config: RealtimeConfig): RoomBackend {
  if (config.mode === 'supabase' && config.supabaseUrl && config.supabaseKey) {
    return new SupabaseBackend(config.supabaseUrl, config.supabaseKey);
  }
  if (config.mode === 'relay' && config.relayUrl) return new RelayBackend(config.relayUrl);
  return new LocalBackend();
}

let shared: RoomBackend | null = null;

/** The app's one backend (one sign-in, one connection). */
export function backend(): RoomBackend {
  shared ??= createBackend(realtimeConfig);
  return shared;
}
