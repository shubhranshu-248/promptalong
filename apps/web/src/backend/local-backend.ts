import type { Transport } from '@promptalong/core';
import { LocalOnlyTransport } from '../realtime/local-transport';
import { getPid } from '../room/identity';
import type { ActionResult, JoinResult, RoomBackend, RoomInfo, TouchResult } from './types';

const NO_SERVER: ActionResult = { ok: false, reason: 'unavailable' };

/** No realtime configured: every room lives on this device only (ADR-008). */
export class LocalBackend implements RoomBackend {
  readonly server = false;

  uid(): Promise<string | null> {
    return Promise.resolve(getPid());
  }

  createRoom(input: { code: string; name: string }): Promise<JoinResult> {
    return Promise.resolve(this.open(input.code, input.name));
  }

  joinRoom(code: string): Promise<JoinResult> {
    return Promise.resolve(this.open(code, ''));
  }

  touch(roomId: string): Promise<TouchResult> {
    return Promise.resolve({ ok: true, room: this.info(roomId, '') });
  }

  leave(): void {
    // nothing to tell anyone
  }

  setLocked(): Promise<ActionResult> {
    return Promise.resolve(NO_SERVER);
  }

  removeMember(): Promise<ActionResult> {
    return Promise.resolve(NO_SERVER);
  }

  transferHost(): Promise<ActionResult> {
    return Promise.resolve(NO_SERVER);
  }

  deleteRoom(): Promise<ActionResult> {
    return Promise.resolve(NO_SERVER);
  }

  loadSnapshot(): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }

  saveSnapshot(): Promise<ActionResult> {
    return Promise.resolve({ ok: true });
  }

  transport(): Transport {
    return new LocalOnlyTransport();
  }

  private info(code: string, name: string): RoomInfo {
    return { id: code, code, name, hostUid: '', locked: false };
  }

  private open(code: string, name: string): JoinResult {
    return { ok: true, room: this.info(code, name), uid: getPid(), slot: 0 };
  }
}
