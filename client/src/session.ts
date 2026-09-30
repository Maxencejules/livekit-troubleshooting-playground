import { summarize, type CounterHistory, type Diagnostics, type StatsSource } from './diagnostics';
import { type EventCode, type Phase } from './snapshot';

export interface ConnectionSettings { serverUrl: string; roomName: string; identity: string; publishMicrophone: boolean }
export interface SessionView {
  mode: 'live' | 'fixture'; phase: Phase; participants: number | null; diagnostics: Diagnostics | null;
  statsFailed: boolean; error: EventCode | null; microphone: 'off' | 'pending' | 'published' | 'failed';
}
export const initialView: SessionView = { mode: 'live', phase: 'idle', participants: null, diagnostics: null, statsFailed: false, error: null, microphone: 'off' };
export interface RoomSession {
  subscribe(onState: (state: 'connected' | 'connecting' | 'reconnecting' | 'disconnected') => void, onParticipants: (count: number) => void): () => void;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  publishMicrophone(): Promise<void>;
  collectStats(): Promise<StatsSource[]>;
  participantCount(): number;
}
interface Dependencies {
  createRoom: () => RoomSession;
  requestToken: (settings: ConnectionSettings, signal: AbortSignal) => Promise<string>;
  onView: (view: SessionView) => void;
  onEvent: (code: EventCode) => void;
  now?: () => number;
}
export class TokenError extends Error { readonly code: 'token_not_configured' | 'token_failed'; constructor(code: 'token_not_configured' | 'token_failed') { super(code); this.code = code; } }

export function validateSettings(settings: ConnectionSettings): ConnectionSettings {
  const serverUrl = settings.serverUrl.trim();
  if (serverUrl.length > 2048) throw new Error('Enter a WebSocket URL without credentials, a query or a fragment.');
  let url: URL;
  try { url = new URL(serverUrl); } catch { throw new Error('Enter a valid ws:// or wss:// LiveKit URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['ws:', 'wss:'].includes(url.protocol) || (url.protocol === 'ws:' && !loopback) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use wss://, or ws:// on loopback, without credentials, a query or a fragment.');
  }
  const field = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 100 || Array.from(trimmed).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Room and identity must contain 1–100 characters without control characters.');
    return trimmed;
  };
  return { serverUrl: url.toString(), roomName: field(settings.roomName), identity: field(settings.identity), publishMicrophone: settings.publishMicrophone === true };
}

// One owner per attempt. Event handlers are attached before connect; stale promises cannot update the view.
export class SessionController {
  private view: SessionView = { ...initialView };
  private generation = 0;
  private active: { room: RoomSession; unsubscribe: () => void } | null = null;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;
  private history: CounterHistory = new Map();
  private disposed = false;
  private now: () => number;
  private dependencies: Dependencies;
  constructor(dependencies: Dependencies) { this.dependencies = dependencies; this.now = dependencies.now ?? Date.now; }
  private update(change: Partial<SessionView>) { this.view = { ...this.view, ...change }; if (!this.disposed) this.dependencies.onView(this.view); }
  private current(generation: number) { return generation === this.generation && !this.disposed; }
  private event(code: EventCode) { if (!this.disposed) this.dependencies.onEvent(code); }
  private async release() {
    this.abort?.abort(); this.abort = null;
    if (this.tokenTimer !== null) clearTimeout(this.tokenTimer);
    this.tokenTimer = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const active = this.active; this.active = null;
    active?.unsubscribe();
    if (active) await active.room.disconnect().catch(() => undefined);
  }
  async connect(settings: ConnectionSettings): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.update({ ...initialView, phase: 'requesting-token' });
    this.event('connect_requested');
    await this.release();
    if (!this.current(generation)) return;
    this.history = new Map();
    const abort = new AbortController(); this.abort = abort;
    let timedOut = false;
    const tokenTimer = setTimeout(() => { timedOut = true; abort.abort(); }, 10000);
    this.tokenTimer = tokenTimer;
    let room: RoomSession | null = null;
    let stage: 'token' | 'connect' = 'token';
    try {
      const token = await this.dependencies.requestToken(settings, abort.signal);
      clearTimeout(tokenTimer);
      if (!this.current(generation)) return;
      if (timedOut || abort.signal.aborted) throw new TokenError('token_failed');
      stage = 'connect';
      room = this.dependencies.createRoom();
      const ownedRoom = room;
      const unsubscribe = room.subscribe(state => {
        if (!this.current(generation)) return;
        if (state === 'disconnected') { void this.stop(); return; }
        this.update({ phase: state });
        if (state === 'reconnecting') this.event('reconnecting');
      }, participants => { if (this.current(generation)) this.update({ participants }); });
      this.active = { room, unsubscribe };
      this.update({ phase: 'connecting' });
      await room.connect(settings.serverUrl, token);
      if (!this.current(generation)) { await room.disconnect().catch(() => undefined); return; }
      this.update({ phase: 'connected', participants: room.participantCount() });
      this.event('connected');
      void this.poll(generation, ownedRoom);
      if (settings.publishMicrophone) {
        this.update({ microphone: 'pending' });
        try {
          await room.publishMicrophone();
          if (this.current(generation)) { this.update({ microphone: 'published' }); this.event('microphone_published'); }
        } catch {
          if (this.current(generation)) { this.update({ microphone: 'failed' }); this.event('microphone_failed'); }
        }
      }
    } catch (error) {
      if (!this.current(generation)) { if (room) await room.disconnect().catch(() => undefined); return; }
      const code: EventCode = stage === 'connect' ? 'connect_failed' : timedOut ? 'token_timeout' : error instanceof TokenError ? error.code : 'token_failed';
      await this.release();
      if (this.current(generation)) { this.update({ phase: 'disconnected', participants: null, error: code, microphone: 'off' }); this.event(code); }
    } finally { clearTimeout(tokenTimer); if (this.tokenTimer === tokenTimer) this.tokenTimer = null; if (this.abort === abort) this.abort = null; }
  }
  private async poll(generation: number, room: RoomSession) {
    if (!this.current(generation)) return;
    if (this.view.phase === 'connected') {
      try {
        const sources = await room.collectStats();
        if (!this.current(generation)) return;
        const result = summarize(sources, this.now(), this.history);
        this.history = result.history;
        this.update({ diagnostics: result.diagnostics, statsFailed: false });
      } catch {
        if (!this.current(generation)) return;
        this.update({ statsFailed: true }); this.event('stats_failed');
      }
    }
    if (this.current(generation)) this.timer = setTimeout(() => { this.timer = null; void this.poll(generation, room); }, 5000);
  }
  async stop(): Promise<void> {
    ++this.generation;
    this.update({ phase: 'disconnected', participants: null, microphone: 'off', diagnostics: null, statsFailed: false });
    this.event('disconnected');
    await this.release();
  }
  async fixture(diagnostics: Diagnostics): Promise<void> {
    const generation = ++this.generation;
    this.update({ ...initialView, mode: 'fixture', diagnostics });
    this.event('fixture_loaded');
    await this.release();
    if (this.current(generation)) this.history = new Map();
  }
  dispose(): void { this.disposed = true; ++this.generation; void this.release(); }
}
