export const LIMITS = { sources: 8, rows: 256, transports: 8, logs: 200, exportBytes: 65536 } as const;

export interface StatsSource {
  // Internal correlation only. Track and WebRTC IDs never enter a snapshot.
  key: string;
  direction: 'local' | 'remote';
  kind: 'audio' | 'video';
  rows: unknown[];
}

export interface TransportSummary {
  label: string;
  selectedPairAvailable: boolean;
  iceState: string | null;
  dtlsState: string | null;
  stunRttMs: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  sentBitsPerSecond: number | null;
  receivedBitsPerSecond: number | null;
  counterReset: boolean;
  counterSource: 'transport' | 'candidate-pair' | null;
}

export interface Diagnostics {
  sampledAt: string;
  sources: { label: string; direction: 'local' | 'remote'; kind: 'audio' | 'video'; transports: TransportSummary[] }[];
  truncated: boolean;
}

interface CounterSample { timestamp: number; sent: number | null; received: number | null }
export type CounterHistory = Map<string, CounterSample>;
type Row = Record<string, unknown>;

function row(value: unknown): Row | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
}
export function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function counter(value: unknown): number | null {
  const number = nonnegative(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}
function enumValue(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}

// IDs are resolved within one RTCStatsReport, never across tracks/peer connections.
export function summarize(sources: StatsSource[], now: number, previous: CounterHistory = new Map()): { diagnostics: Diagnostics; history: CounterHistory } {
  const history: CounterHistory = new Map();
  let truncated = sources.length > LIMITS.sources;
  const summaries = sources.slice(0, LIMITS.sources).map((source, index) => {
    if (source.rows.length > LIMITS.rows) truncated = true;
    const rows = source.rows.slice(0, LIMITS.rows).map(row).filter((value): value is Row => value !== null);
    const byId = new Map(rows.filter(value => typeof value.id === 'string').map(value => [value.id as string, value]));
    const transports = rows.filter(value => value.type === 'transport');
    if (transports.length > LIMITS.transports) truncated = true;
    return {
      label: `Track ${index + 1}`, direction: source.direction, kind: source.kind,
      transports: transports.slice(0, LIMITS.transports).map((transport, transportIndex): TransportSummary => {
        const candidate = typeof transport.selectedCandidatePairId === 'string' ? byId.get(transport.selectedCandidatePairId) : undefined;
        const pair = candidate?.type === 'candidate-pair' ? candidate : undefined;
        // Use one counter scope for both directions. Do not mix a transport with an unrelated pair.
        const hasTransportCounters = counter(transport.bytesSent) !== null || counter(transport.bytesReceived) !== null;
        const counters = hasTransportCounters ? transport : pair;
        const counterSource = hasTransportCounters ? 'transport' : pair ? 'candidate-pair' : null;
        const sent = counter(counters?.bytesSent);
        const received = counter(counters?.bytesReceived);
        const timestamp = nonnegative(counters?.timestamp);
        // Pair identity matters only for pair-scoped counters. A switch resets the delta baseline.
        const key = JSON.stringify([source.key, transport.id, counterSource, counterSource === 'candidate-pair' ? pair?.id : null]);
        const before = previous.get(key);
        const elapsed = timestamp !== null && before ? timestamp - before.timestamp : 0;
        const reset = Boolean(before && ((sent !== null && before.sent !== null && sent < before.sent) || (received !== null && before.received !== null && received < before.received)));
        const rate = (value: number | null, old: number | null | undefined) => !reset && elapsed > 0 && value !== null && old != null ? nonnegative((value - old) * 8000 / elapsed) : null;
        if (timestamp !== null) history.set(key, { timestamp, sent, received });
        const rtt = nonnegative(pair?.currentRoundTripTime);
        return {
          label: `Transport ${transportIndex + 1}`, selectedPairAvailable: Boolean(pair),
          iceState: enumValue(transport.iceState, ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed']),
          dtlsState: enumValue(transport.dtlsState, ['new', 'connecting', 'connected', 'closed', 'failed']),
          stunRttMs: rtt === null ? null : nonnegative(rtt * 1000),
          bytesSent: sent, bytesReceived: received,
          sentBitsPerSecond: rate(sent, before?.sent), receivedBitsPerSecond: rate(received, before?.received),
          counterReset: reset, counterSource,
        };
      }),
    };
  });
  return { diagnostics: { sampledAt: new Date(now).toISOString(), sources: summaries, truncated }, history };
}
