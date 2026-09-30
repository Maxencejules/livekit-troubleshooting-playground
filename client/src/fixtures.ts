import { summarize, type StatsSource } from './diagnostics';

export const fixtureNames = ['Selected pair', 'High RTT', 'Missing fields', 'Counter reset'] as const;
export type FixtureName = typeof fixtureNames[number];
export function fixture(name: FixtureName, now: number) {
  const source = (timestamp: number, sent: number, received: number, rtt = 0.025): StatsSource[] => [{
    key: 'fixture-only', direction: 'remote', kind: 'audio', rows: [
      { id: 'wrong-pair', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 9, bytesSent: 999999 },
      { id: 'selected-pair', type: 'candidate-pair', currentRoundTripTime: rtt, state: 'succeeded' },
      { id: 'transport', type: 'transport', selectedCandidatePairId: 'selected-pair', iceState: 'connected', dtlsState: 'connected', timestamp, bytesSent: sent, bytesReceived: received },
    ],
  }];
  const before = summarize(source(1000, 2000, 4000), now - 5000);
  if (name === 'Missing fields') return summarize([{ key: 'fixture-only', direction: 'remote', kind: 'video', rows: [
    { id: 'wrong-pair', type: 'candidate-pair', nominated: true, currentRoundTripTime: 9 },
    { id: 'transport', type: 'transport', selectedCandidatePairId: 'not-exposed' },
  ] }], now).diagnostics;
  return summarize(source(6000, name === 'Counter reset' ? 0 : 10000, name === 'Counter reset' ? 0 : 12000, name === 'High RTT' ? 0.9 : 0.025), now, before.history).diagnostics;
}
