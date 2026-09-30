import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  capture: vi.fn(),
  rooms: [] as {
    disconnect: ReturnType<typeof vi.fn>; localParticipant: { publishTrack: ReturnType<typeof vi.fn>; trackPublications: Map<string, unknown> };
    remoteParticipants: Map<string, unknown>; on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('livekit-client', () => ({
  ConnectionState: { Connected: 'connected', Connecting: 'connecting', Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting', Disconnected: 'disconnected' },
  LogLevel: { silent: 5 }, setLogLevel: vi.fn(), createLocalAudioTrack: sdk.capture,
  RoomEvent: { ConnectionStateChanged: 'state', ParticipantConnected: 'join', ParticipantDisconnected: 'leave' },
  Room: class {
    localParticipant = { publishTrack: vi.fn(async () => {}), trackPublications: new Map<string, unknown>() };
    remoteParticipants = new Map<string, unknown>(); numParticipants = 1;
    disconnect = vi.fn(async () => {}); connect = vi.fn(async () => {}); on = vi.fn(); off = vi.fn();
    constructor() { sdk.rooms.push(this); }
    get engine() { throw new Error('Private engine traversal forbidden'); }
  },
}));
import { LiveKitSession, requestToken } from './livekit';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { sdk.rooms.length = 0; sdk.capture.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });
describe('public SDK adapter and microphone ownership', () => {
  it('stops late capture after disconnect without publishing it', async () => {
    const pending = deferred<{ stop: ReturnType<typeof vi.fn> }>(); sdk.capture.mockReturnValue(pending.promise);
    const session = new LiveKitSession(); const publishing = session.publishMicrophone();
    await session.disconnect(); const track = { stop: vi.fn() }; pending.resolve(track);
    await expect(publishing).rejects.toThrow();
    expect(track.stop).toHaveBeenCalledOnce(); expect(sdk.rooms[0].localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(sdk.rooms[0].disconnect).toHaveBeenCalledWith(true);
  });
  it('stops an owned track during pending publication and rejects its late success', async () => {
    const pending = deferred<void>(); const track = { stop: vi.fn() }; sdk.capture.mockResolvedValue(track);
    const session = new LiveKitSession(); sdk.rooms[0].localParticipant.publishTrack.mockReturnValue(pending.promise);
    const publishing = session.publishMicrophone(); await Promise.resolve();
    await session.disconnect(); expect(track.stop).toHaveBeenCalled();
    pending.resolve(undefined); await expect(publishing).rejects.toThrow();
  });
  it('stops capture on a publication failure', async () => {
    const track = { stop: vi.fn() }; sdk.capture.mockResolvedValue(track);
    const session = new LiveKitSession(); sdk.rooms[0].localParticipant.publishTrack.mockRejectedValue(new Error('secret'));
    await expect(session.publishMicrophone()).rejects.toThrow('Microphone unavailable');
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('reads public track reports only, caps queries, and does not visit Room.engine', async () => {
    const session = new LiveKitSession(); const reports = new Map([['transport', { id: 'transport', type: 'transport', bytesSent: 0 }]]);
    const getStats = vi.fn(async () => reports);
    for (let i = 0; i < 10; i++) sdk.rooms[0].localParticipant.trackPublications.set(String(i), { trackSid: String(i), track: { kind: 'audio', getRTCStatsReport: getStats } });
    const result = await session.collectStats();
    expect(getStats).toHaveBeenCalledTimes(8); expect(result).toHaveLength(9);
    expect(result[0].rows).toEqual([{ id: 'transport', type: 'transport', bytesSent: 0 }]);
  });
  it('maps signaling reconnects through the public connection-state event', () => {
    const session = new LiveKitSession(); const state = vi.fn(); const unsubscribe = session.subscribe(state, vi.fn());
    const handler = sdk.rooms[0].on.mock.calls.find(call => call[0] === 'state')?.[1];
    handler('signalReconnecting'); handler('connected');
    expect(state.mock.calls).toEqual([['reconnecting'], ['connected']]);
    unsubscribe(); expect(sdk.rooms[0].off).toHaveBeenCalledTimes(3);
  });
  it('treats unavailable public stats as an empty report', async () => {
    const session = new LiveKitSession();
    sdk.rooms[0].localParticipant.trackPublications.set('track', { trackSid: 'track', track: { kind: 'video', getRTCStatsReport: vi.fn(async () => undefined) } });
    expect((await session.collectStats())[0].rows).toEqual([]);
  });
});
describe('local token response contract', () => {
  const settings = { serverUrl: 'ws://127.0.0.1:7880', roomName: 'room', identity: 'dev', publishMicrophone: false };
  it('uses a relative local API route and forwards cancellation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ token: 'test-token' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch); const signal = new AbortController().signal;
    expect(await requestToken(settings, signal)).toBe('test-token');
    expect(fetch.mock.calls[0][0]).toBe('/api/token');
    expect(fetch.mock.calls[0][1]).toMatchObject({ signal });
  });
  it.each([{}, { token: 12 }, { token: '' }, { token: 'x'.repeat(16385) }])('rejects malformed success payload', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))));
    await expect(requestToken(settings, new AbortController().signal)).rejects.toThrow('token_failed');
  });
  it('does not expose a server error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'API-SECRET' }), { status: 503 })));
    await expect(requestToken(settings, new AbortController().signal)).rejects.toThrow('token_not_configured');
  });
});
