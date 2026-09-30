import { describe, expect, it } from 'vitest';
import { LIMITS, summarize, type StatsSource } from './diagnostics';
import { fixture } from './fixtures';
import { snapshotText, type LogEntry } from './snapshot';

const now = Date.parse('2026-01-02T03:04:05Z');
const source = (rows: unknown[], key = 'secret-track'): StatsSource[] => [{ key, direction: 'remote', kind: 'audio', rows }];
const pair = { id: 'selected', type: 'candidate-pair', currentRoundTripTime: 0.03 };
const transport = { id: 'transport', type: 'transport', selectedCandidatePairId: 'selected', timestamp: 1000, bytesSent: 0, bytesReceived: 10 };
const summary = (rows: unknown[]) => summarize(source(rows), now).diagnostics.sources[0].transports[0];

describe('WebRTC interpretation', () => {
  it('follows selectedCandidatePairId rather than the first nominated/succeeded pair', () => {
    const result = summary([{ id: 'wrong', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 9 }, pair, transport]);
    expect(result.stunRttMs).toBe(30);
    expect(result.bytesSent).toBe(0);
    expect(result.counterSource).toBe('transport');
  });
  it('does not guess a selected pair when the browser omits the reference', () => {
    const result = summary([pair, { id: 't', type: 'transport' }]);
    expect(result).toMatchObject({ selectedPairAvailable: false, stunRttMs: null, bytesSent: null, bytesReceived: null });
  });
  it('rejects a reference to another stats type', () => {
    expect(summary([{ id: 'selected', type: 'codec', currentRoundTripTime: 1 }, transport]).selectedPairAvailable).toBe(false);
  });
  it('preserves zero RTT and zero counters', () => {
    expect(summary([{ ...pair, currentRoundTripTime: 0 }, transport])).toMatchObject({ stunRttMs: 0, bytesSent: 0 });
  });
  it('falls back only to counters in the referenced pair, without mixing scopes', () => {
    expect(summary([{ ...pair, timestamp: 1000, bytesSent: 5, bytesReceived: 7 }, { id: 't', type: 'transport', selectedCandidatePairId: 'selected' }])).toMatchObject({ counterSource: 'candidate-pair', bytesSent: 5, bytesReceived: 7 });
    expect(summary([{ ...pair, bytesReceived: 999 }, { ...transport, bytesReceived: undefined }]).bytesReceived).toBeNull();
  });
  it('computes bit/s from elapsed stats milliseconds and counter differences', () => {
    const before = summarize(source([pair, transport]), now);
    const after = summarize(source([pair, { ...transport, timestamp: 3000, bytesSent: 2000, bytesReceived: 1010 }]), now + 2000, before.history);
    expect(after.diagnostics.sources[0].transports[0]).toMatchObject({ sentBitsPerSecond: 8000, receivedBitsPerSecond: 4000 });
    expect(before.diagnostics.sources[0].transports[0].sentBitsPerSecond).toBeNull();
  });
  it('invalidates the reset interval, then establishes a new delta baseline', () => {
    const before = summarize(source([pair, { ...transport, bytesSent: 100 }]), now);
    const reset = summarize(source([pair, { ...transport, timestamp: 2000, bytesSent: 0 }]), now, before.history);
    expect(reset.diagnostics.sources[0].transports[0]).toMatchObject({ counterReset: true, sentBitsPerSecond: null, bytesSent: 0 });
    const after = summarize(source([pair, { ...transport, timestamp: 3000, bytesSent: 100 }]), now, reset.history);
    expect(after.diagnostics.sources[0].transports[0].sentBitsPerSecond).toBe(800);
  });
  it('rejects non-finite, negative and unsafe counters; unknown states stay unavailable', () => {
    expect(summary([{ ...pair, currentRoundTripTime: Infinity }, { ...transport, bytesSent: NaN, bytesReceived: -1, iceState: 'secret', dtlsState: false }])).toMatchObject({ stunRttMs: null, bytesSent: null, bytesReceived: null, iceState: null, dtlsState: null });
    expect(summary([{ ...transport, bytesSent: Number.MAX_SAFE_INTEGER + 1 }]).bytesSent).toBeNull();
  });
  it('does not produce a rate for repeated or missing timestamps', () => {
    const before = summarize(source([transport]), now);
    for (const timestamp of [1000, undefined, NaN, 500]) {
      expect(summarize(source([{ ...transport, timestamp, bytesSent: 100 }]), now, before.history).diagnostics.sources[0].transports[0].sentBitsPerSecond).toBeNull();
    }
  });
  it('isolates identical WebRTC IDs from different track reports', () => {
    const sources = [...source([pair, transport], 'A'), ...source([{ ...pair, currentRoundTripTime: 1 }, { ...transport, bytesSent: 50 }], 'B')];
    const result = summarize(sources, now);
    expect(result.diagnostics.sources.map(item => item.transports[0].stunRttMs)).toEqual([30, 1000]);
    expect(result.history.size).toBe(2);
  });
  it('does not carry pair-counter rates across a selected-pair switch', () => {
    const before = summarize(source([{ ...pair, timestamp: 1000, bytesSent: 10 }, { id: 't', type: 'transport', selectedCandidatePairId: 'selected' }]), now);
    const after = summarize(source([{ ...pair, id: 'other', timestamp: 2000, bytesSent: 900 }, { id: 't', type: 'transport', selectedCandidatePairId: 'other' }]), now, before.history);
    expect(after.diagnostics.sources[0].transports[0].sentBitsPerSecond).toBeNull();
  });
  it('bounds reports and flags truncation', () => {
    const rows = Array.from({ length: LIMITS.rows + 1 }, (_, index) => ({ id: String(index), type: 'transport' }));
    const result = summarize(Array.from({ length: LIMITS.sources + 1 }, () => source(rows)[0]), now);
    expect(result.diagnostics.truncated).toBe(true);
    expect(result.diagnostics.sources).toHaveLength(LIMITS.sources);
    expect(result.diagnostics.sources[0].transports).toHaveLength(LIMITS.transports);
    expect(summary([null, false, [], 'secret', transport]).bytesSent).toBe(0);
  });
});

describe('fixtures and allowlisted export', () => {
  it.each(['Selected pair', 'High RTT', 'Missing fields', 'Counter reset'] as const)('fixture %s is deterministic', name => {
    expect(fixture(name, now)).toEqual(fixture(name, now));
  });
  it('demonstrates missing versus zero and the counter-reset bound', () => {
    expect(fixture('Missing fields', now).sources[0].transports[0].stunRttMs).toBeNull();
    expect(fixture('Counter reset', now).sources[0].transports[0]).toMatchObject({ bytesSent: 0, counterReset: true, sentBitsPerSecond: null });
  });
  it('omits identifiers, network addresses, raw errors and arbitrary extra properties', () => {
    const secret = 'eyJ-secret-room-identity-ip';
    const diagnostics = summarize(source([{ ...pair, address: secret, url: secret }, { ...transport, certificate: secret }], secret), now).diagnostics;
    Object.assign(diagnostics, { jwt: secret });
    Object.assign(diagnostics.sources[0], { identity: secret, label: secret });
    Object.assign(diagnostics.sources[0].transports[0], { label: secret, dtlsState: secret, rawError: secret });
    const logs = [{ timestamp: new Date(now).toISOString(), code: 'connect_failed', message: secret }] as unknown as LogEntry[];
    const text = snapshotText({ mode: 'live', phase: 'connected', participants: 2, diagnostics, logs, serverUrl: secret } as Parameters<typeof snapshotText>[0], now);
    expect(text).not.toContain(secret);
    expect(JSON.parse(text).logs[0].message).toBe('LiveKit connection failed. Check your endpoint and developer server configuration.');
  });
  it('enforces UTF-8 export size and event count, even at maximum report size', () => {
    const diagnostics = summarize(Array.from({ length: 9 }, () => source(Array.from({ length: 9 }, (_, index) => ({ id: String(index), type: 'transport' })))[0]), now).diagnostics;
    const logs = Array.from({ length: 1000 }, () => ({ timestamp: new Date(now).toISOString(), code: 'token_not_configured' as const }));
    const text = snapshotText({ mode: 'fixture', phase: 'idle', participants: 999, diagnostics, logs }, now);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(LIMITS.exportBytes);
    expect(JSON.parse(text).logs.length).toBeLessThanOrEqual(LIMITS.logs);
    expect(JSON.parse(text).connection.participants).toBeNull();
  });
});
