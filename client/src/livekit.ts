import { ConnectionState, createLocalAudioTrack, LogLevel, Room, RoomEvent, setLogLevel, type LocalAudioTrack } from 'livekit-client';
import { LIMITS, type StatsSource } from './diagnostics';
import { TokenError, type ConnectionSettings, type RoomSession } from './session';

// SDK errors may include signaling URLs/identities. Use fixed event codes instead.
setLogLevel(LogLevel.silent);

export async function requestToken(settings: ConnectionSettings, signal: AbortSignal): Promise<string> {
  const response = await fetch('/api/token', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName: settings.roomName, identity: settings.identity, publishMicrophone: settings.publishMicrophone }),
  });
  if (!response.ok) throw new TokenError(response.status === 503 ? 'token_not_configured' : 'token_failed');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string' || data.token.length < 1 || data.token.length > 16384) throw new TokenError('token_failed');
  return data.token;
}

export class LiveKitSession implements RoomSession {
  private room = new Room();
  private closed = false;
  private microphone: LocalAudioTrack | null = null;
  subscribe(onState: Parameters<RoomSession['subscribe']>[0], onParticipants: (count: number) => void) {
    const state = (value: ConnectionState) => {
      switch (value) {
        case ConnectionState.Connected: onState('connected'); break;
        case ConnectionState.Connecting: onState('connecting'); break;
        case ConnectionState.Reconnecting:
        case ConnectionState.SignalReconnecting: onState('reconnecting'); break;
        case ConnectionState.Disconnected: onState('disconnected'); break;
      }
    };
    const participants = () => onParticipants(this.room.numParticipants);
    this.room.on(RoomEvent.ConnectionStateChanged, state);
    this.room.on(RoomEvent.ParticipantConnected, participants);
    this.room.on(RoomEvent.ParticipantDisconnected, participants);
    return () => {
      this.room.off(RoomEvent.ConnectionStateChanged, state);
      this.room.off(RoomEvent.ParticipantConnected, participants);
      this.room.off(RoomEvent.ParticipantDisconnected, participants);
    };
  }
  async connect(url: string, token: string) { await this.room.connect(url, token, { autoSubscribe: true }); }
  async disconnect() {
    this.closed = true;
    this.microphone?.stop(); this.microphone = null;
    await this.room.disconnect(true);
  }
  async publishMicrophone() {
    const track = await createLocalAudioTrack();
    // Capture may finish after Cancel/unmount. Stop that late track before publication.
    if (this.closed) { track.stop(); throw new Error('Session closed'); }
    this.microphone = track;
    try {
      await this.room.localParticipant.publishTrack(track);
      if (this.closed) { track.stop(); throw new Error('Session closed'); }
    } catch {
      track.stop(); if (this.microphone === track) this.microphone = null;
      throw new Error('Microphone unavailable');
    }
  }
  participantCount() { return this.room.numParticipants; }
  async collectStats(): Promise<StatsSource[]> {
    const tracks = [
      ...Array.from(this.room.localParticipant.trackPublications.values(), publication => ({ publication, direction: 'local' as const })),
      ...Array.from(this.room.remoteParticipants.values()).flatMap(participant => Array.from(participant.trackPublications.values(), publication => ({ publication, direction: 'remote' as const }))),
    ].filter(({ publication }) => publication.track);
    const sources: StatsSource[] = [];
    for (const { publication, direction } of tracks.slice(0, LIMITS.sources)) {
      const track = publication.track;
      if (!track || (track.kind !== 'audio' && track.kind !== 'video')) continue;
      const report = await track.getRTCStatsReport();
      const rows: unknown[] = [];
      report?.forEach(value => { if (rows.length <= LIMITS.rows) rows.push(value); });
      sources.push({ key: `${direction}:${publication.trackSid}`, direction, kind: track.kind, rows });
    }
    // Report truncation without querying extra tracks.
    if (tracks.length > LIMITS.sources) sources.push({ key: 'truncated', direction: 'remote', kind: 'audio', rows: [] });
    return sources;
  }
}
