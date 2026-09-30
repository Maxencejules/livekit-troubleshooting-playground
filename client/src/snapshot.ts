import { LIMITS, nonnegative, type Diagnostics } from './diagnostics';

export const EVENTS = {
  connect_requested: ['info', 'Connection requested.'],
  token_not_configured: ['error', 'Local token server has no credentials configured. Use offline fixtures or configure your own developer server.'],
  token_failed: ['error', 'Token request failed. Check the local server and its configuration.'],
  token_timeout: ['error', 'Token request timed out.'],
  connect_failed: ['error', 'LiveKit connection failed. Check your endpoint and developer server configuration.'],
  connected: ['info', 'LiveKit connection established.'],
  reconnecting: ['warn', 'LiveKit is reconnecting.'],
  disconnected: ['info', 'Session disconnected; local tracks stopped.'],
  microphone_published: ['info', 'Opt-in microphone track published.'],
  microphone_failed: ['warn', 'Microphone capture or publication failed. The connection remains available.'],
  stats_failed: ['warn', 'Stats collection failed. The last successful sample is retained.'],
  fixture_loaded: ['info', 'Offline fixture loaded; no room connection or microphone access.'],
} as const;
export type EventCode = keyof typeof EVENTS;
export interface LogEntry { timestamp: string; code: EventCode }
export type Phase = 'idle' | 'requesting-token' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export function eventMessage(code: EventCode): string { return EVENTS[code][1]; }

// A schema allowlist, not a dump of SDK state. Even accidental extra properties are discarded.
export function snapshotText(input: { mode: 'live' | 'fixture'; phase: Phase; participants: number | null; diagnostics: Diagnostics | null; logs: LogEntry[] }, now: number): string {
  const diagnostics = input.diagnostics;
  const output = {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    mode: input.mode === 'fixture' ? 'fixture' : 'live',
    connection: {
      state: ['idle', 'requesting-token', 'connecting', 'connected', 'reconnecting', 'disconnected'].includes(input.phase) ? input.phase : 'idle',
      participants: input.mode === 'fixture' ? null : nonnegative(input.participants),
    },
    diagnostics: diagnostics ? {
      sampledAt: safeDate(diagnostics.sampledAt), truncated: Boolean(diagnostics.truncated),
      sources: diagnostics.sources.slice(0, LIMITS.sources).map((source, index) => ({
        label: `Track ${index + 1}`, direction: source.direction === 'local' ? 'local' : 'remote', kind: source.kind === 'audio' ? 'audio' : 'video',
        transports: source.transports.slice(0, LIMITS.transports).map((transport, transportIndex) => ({
          label: `Transport ${transportIndex + 1}`, selectedPairAvailable: Boolean(transport.selectedPairAvailable),
          iceState: safeState(transport.iceState, ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed']),
          dtlsState: safeState(transport.dtlsState, ['new', 'connecting', 'connected', 'closed', 'failed']),
          stunRttMs: nonnegative(transport.stunRttMs), bytesSent: nonnegative(transport.bytesSent), bytesReceived: nonnegative(transport.bytesReceived),
          sentBitsPerSecond: nonnegative(transport.sentBitsPerSecond), receivedBitsPerSecond: nonnegative(transport.receivedBitsPerSecond),
          counterReset: Boolean(transport.counterReset), counterSource: transport.counterSource === 'transport' || transport.counterSource === 'candidate-pair' ? transport.counterSource : null,
        })),
      })),
    } : null,
    logs: input.logs.slice(-LIMITS.logs).filter(log => Object.hasOwn(EVENTS, log.code)).map(log => ({ timestamp: safeDate(log.timestamp), code: log.code, level: EVENTS[log.code][0], message: eventMessage(log.code) })),
    redaction: 'Room names, identities, endpoint URLs, tokens, addresses, SDP, raw stats and raw errors are omitted.',
  };
  let text = JSON.stringify(output, null, 2);
  while (new TextEncoder().encode(text).length > LIMITS.exportBytes && output.logs.length > 0) {
    output.logs.shift();
    text = JSON.stringify(output, null, 2);
  }
  // Bounded schema fields make this unreachable for valid input, including the maximum 64 transports.
  if (new TextEncoder().encode(text).length > LIMITS.exportBytes) throw new Error('Snapshot exceeds size limit');
  return text;
}
function safeDate(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function safeState(value: unknown, states: string[]): string | null { return typeof value === 'string' && states.includes(value) ? value : null; }
