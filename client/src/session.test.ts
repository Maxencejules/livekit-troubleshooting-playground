import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from './fixtures';
import { initialView, SessionController, TokenError, validateSettings, type ConnectionSettings, type RoomSession, type SessionView } from './session';
import type { EventCode } from './snapshot';
import type { StatsSource } from './diagnostics';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const settings: ConnectionSettings = { serverUrl: 'ws://127.0.0.1:7880', roomName: 'room', identity: 'developer', publishMicrophone: false };
class FakeRoom implements RoomSession {
  stateHandler: Parameters<RoomSession['subscribe']>[0] = () => {};
  participantHandler: (count: number) => void = () => {};
  subscribed = false;
  connect = vi.fn(async () => { expect(this.subscribed).toBe(true); this.stateHandler('connected'); });
  disconnect = vi.fn(async () => {});
  publishMicrophone = vi.fn(async () => {});
  collectStats = vi.fn<() => Promise<StatsSource[]>>(async () => []);
  participantCount = () => 2;
  subscribe(state: Parameters<RoomSession['subscribe']>[0], participants: (count: number) => void) {
    this.subscribed = true; this.stateHandler = state; this.participantHandler = participants;
    return () => { this.subscribed = false; };
  }
}
function harness(rooms = [new FakeRoom()], token = vi.fn<(settings: ConnectionSettings, signal: AbortSignal) => Promise<string>>(async () => 'fake-token')) {
  let view: SessionView = { ...initialView };
  const events: EventCode[] = [];
  const createRoom = vi.fn(() => { const room = rooms.shift(); if (!room) throw new Error('No room'); return room; });
  const controller = new SessionController({ createRoom, requestToken: token, onView: next => { view = next; }, onEvent: code => events.push(code), now: () => 10000 });
  return { controller, createRoom, token, events, view: () => view };
}
afterEach(() => vi.useRealTimers());

describe('owned connection lifecycle', () => {
  it('attaches listeners before connect and does not request a microphone by default', async () => {
    const room = new FakeRoom(); const h = harness([room]);
    await h.controller.connect(settings);
    expect(h.view()).toMatchObject({ phase: 'connected', participants: 2, microphone: 'off' });
    expect(room.publishMicrophone).not.toHaveBeenCalled();
    await h.controller.stop();
    expect(room.subscribed).toBe(false);
    expect(room.disconnect).toHaveBeenCalledOnce();
  });
  it('aborts a pending token and ignores its late completion after cancellation', async () => {
    vi.useFakeTimers(); const pending = deferred<string>(); const room = new FakeRoom();
    const h = harness([room], vi.fn(() => pending.promise));
    const connecting = h.controller.connect(settings);
    await Promise.resolve();
    const signal = h.token.mock.calls[0][1];
    await h.controller.stop(); expect(vi.getTimerCount()).toBe(0); pending.resolve('late-secret-token'); await connecting;
    expect(signal.aborted).toBe(true); expect(h.createRoom).not.toHaveBeenCalled();
    expect(h.view().phase).toBe('disconnected');
  });
  it('keeps a replacement attempt authoritative when the old token completes last', async () => {
    const first = deferred<string>(); const room = new FakeRoom();
    const token = vi.fn(async () => 'second-token').mockImplementationOnce(() => first.promise);
    const h = harness([room], token);
    const a = h.controller.connect(settings); await Promise.resolve();
    await h.controller.connect(settings); first.resolve('old-token'); await a;
    expect(room.connect).toHaveBeenCalledExactlyOnceWith(settings.serverUrl, 'second-token');
    expect(h.view().phase).toBe('connected'); h.controller.dispose();
  });
  it('disconnects a pending room again when connect resolves after cancellation', async () => {
    const room = new FakeRoom(); const pending = deferred<void>(); room.connect.mockImplementation(() => pending.promise);
    const h = harness([room]); const connecting = h.controller.connect(settings);
    await Promise.resolve(); await Promise.resolve();
    await h.controller.stop(); pending.resolve(undefined); await connecting;
    expect(room.disconnect).toHaveBeenCalledTimes(2);
    room.stateHandler('connected'); room.participantHandler(999);
    expect(h.view()).toMatchObject({ phase: 'disconnected', participants: null });
  });
  it('cleans up a failed connect and exports only a fixed failure code', async () => {
    const room = new FakeRoom(); room.connect.mockRejectedValue(new Error('JWT identity secret'));
    const h = harness([room]); await h.controller.connect(settings);
    expect(room.disconnect).toHaveBeenCalledOnce(); expect(room.subscribed).toBe(false);
    expect(h.view().error).toBe('connect_failed');
    expect(JSON.stringify(h.events)).not.toContain('secret');
  });
  it('times out token requests and never creates a room', async () => {
    vi.useFakeTimers();
    const token = vi.fn((_settings: ConnectionSettings, signal: AbortSignal) => { void _settings; return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')))); });
    const h = harness([new FakeRoom()], token); const connecting = h.controller.connect(settings);
    await vi.advanceTimersByTimeAsync(10000); await connecting;
    expect(h.view().error).toBe('token_timeout'); expect(h.createRoom).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('distinguishes missing local credentials from a generic token error', async () => {
    const h = harness([], vi.fn(async () => { throw new TokenError('token_not_configured'); }));
    await h.controller.connect(settings); expect(h.view().error).toBe('token_not_configured');
  });
  it('keeps the connected session when opt-in microphone publishing fails', async () => {
    const room = new FakeRoom(); room.publishMicrophone.mockRejectedValue(new Error('secret-device-name'));
    const h = harness([room]); await h.controller.connect({ ...settings, publishMicrophone: true });
    expect(h.view()).toMatchObject({ phase: 'connected', microphone: 'failed' });
    expect(h.events).toContain('microphone_failed'); h.controller.dispose();
  });
  it.each(['stop', 'fixture', 'dispose'] as const)('ignores delayed microphone success after %s', async action => {
    const room = new FakeRoom(); const pending = deferred<void>(); room.publishMicrophone.mockImplementation(() => pending.promise);
    const h = harness([room]); const connecting = h.controller.connect({ ...settings, publishMicrophone: true });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.view().microphone).toBe('pending');
    if (action === 'stop') await h.controller.stop();
    else if (action === 'fixture') await h.controller.fixture(fixture('Selected pair', 10000));
    else h.controller.dispose();
    const stopped = h.view(); pending.resolve(undefined); await connecting;
    expect(h.view()).toEqual(stopped); expect(h.events).not.toContain('microphone_published');
    expect(room.disconnect).toHaveBeenCalled();
  });
  it('does not overlap slow stats reads and ignores a stale read after fixture selection', async () => {
    vi.useFakeTimers(); const room = new FakeRoom(); const pending = deferred<StatsSource[]>();
    room.collectStats.mockImplementation(() => pending.promise);
    const h = harness([room]); await h.controller.connect(settings);
    await vi.advanceTimersByTimeAsync(20000); expect(room.collectStats).toHaveBeenCalledOnce();
    await h.controller.fixture(fixture('High RTT', 10000));
    pending.resolve([]); await Promise.resolve();
    expect(h.view().mode).toBe('fixture'); expect(h.view().diagnostics?.sources[0].transports[0].stunRttMs).toBe(900);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains the last successful stats when a later read fails', async () => {
    vi.useFakeTimers(); const room = new FakeRoom();
    room.collectStats.mockResolvedValueOnce([{ key: 'one', direction: 'remote', kind: 'audio', rows: [{ id: 't', type: 'transport', bytesSent: 0 }] }]).mockRejectedValueOnce(new Error('secret-stats-error'));
    const h = harness([room]); await h.controller.connect(settings); await Promise.resolve();
    const before = h.view().diagnostics;
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.view().diagnostics).toEqual(before); expect(h.view().statsFailed).toBe(true);
    h.controller.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('releases listeners and timers on an SDK disconnected event', async () => {
    vi.useFakeTimers(); const room = new FakeRoom(); const h = harness([room]);
    await h.controller.connect(settings); room.stateHandler('disconnected'); await Promise.resolve();
    expect(h.view().phase).toBe('disconnected'); expect(room.subscribed).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('connection input contract', () => {
  it('trims identifiers and allows secure URLs or loopback plaintext only', () => {
    expect(validateSettings({ ...settings, roomName: ' room ', identity: ' dev ' })).toMatchObject({ roomName: 'room', identity: 'dev' });
    expect(validateSettings({ ...settings, serverUrl: 'wss://developer.example' }).serverUrl).toBe('wss://developer.example/');
    expect(validateSettings({ ...settings, serverUrl: 'ws://[::1]:7880' }).serverUrl).toContain('[::1]');
  });
  it.each(['https://example.com', 'ws://remote.example', 'wss://user:secret@example.com', 'wss://example.com?token=secret', 'wss://example.com#secret', 'not a URL'])('rejects unsafe endpoint %s before use', serverUrl => {
    expect(() => validateSettings({ ...settings, serverUrl })).toThrow();
  });
  it.each(['', 'x'.repeat(101), 'room\nname'])('rejects invalid room identifiers', roomName => {
    expect(() => validateSettings({ ...settings, roomName })).toThrow();
  });
});
