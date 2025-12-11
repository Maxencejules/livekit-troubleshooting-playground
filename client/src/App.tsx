/*
MIT License

Copyright (c) 2025 Maxence Jules

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/


import React, { useEffect, useState, useCallback } from 'react';
import { ConnectionForm, type ConnectionFormValues } from '../components/ConnectionForm';
import { Room, RoomEvent, ConnectionState, createLocalAudioTrack } from 'livekit-client';
import { LogsView, type LogEntry, type LogLevel } from '../components/LogsView';

type ExtendedConnectionState = ConnectionState | 'idle';

type WebRtcSummary = {
    iceState: string | null;
    dtlsState: string | null;
    rttMs: number | null;
    bytesSent: number | null;
    bytesReceived: number | null;
    packetsSent: number | null;
    packetsReceived: number | null;
};

function App() {
    const [lastConnectionAttempt, setLastConnectionAttempt] =
        useState<ConnectionFormValues | null>(null);

    const [room, setRoom] = useState<Room | null>(null);
    const [connectionState, setConnectionState] =
        useState<ExtendedConnectionState>('idle');
    const [participantsCount, setParticipantsCount] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [statsJson, setStatsJson] = useState<string | null>(null); // raw WebRTC stats
    const [webrtcSummary, setWebrtcSummary] = useState<WebRtcSummary | null>(null); // derived health

    const appendLog = useCallback(
        (level: LogLevel, message: string) => {
            setLogs((prev) => {
                const nextId = prev.length ? prev[prev.length - 1].id + 1 : 1;
                const entry: LogEntry = {
                    id: nextId,
                    timestamp: new Date().toISOString(),
                    level,
                    message,
                };
                // keep at most 200 entries
                return [...prev, entry].slice(-200);
            });
        },
        []
    );

    const handleConnect = async (values: ConnectionFormValues) => {
        setLastConnectionAttempt(values);
        setError(null);
        setIsConnecting(true);

        appendLog(
            'info',
            `Connect requested → url=${values.serverUrl}, room=${values.roomName}, identity=${values.identity}`
        );

        try {
            // If already connected to a room, disconnect first
            if (room) {
                appendLog('info', 'Disconnecting from existing room before reconnecting.');
                await room.disconnect();
                setRoom(null);
                setConnectionState(ConnectionState.Disconnected);
                setParticipantsCount(0);
            }

            setConnectionState(ConnectionState.Connecting);

            // 1) Ask our token server for a JWT
            const resp = await fetch('http://localhost:3001/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    roomName: values.roomName,
                    identity: values.identity,
                }),
            });

            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                const msg = body.error || `Token server error: ${resp.status}`;
                appendLog('error', msg);
                throw new Error(msg);
            }

            const data = await resp.json();
            const token = data.token as string;

            appendLog('info', 'Received JWT token from token server.');

            if (!token) {
                const msg = 'Token server returned invalid token payload';
                appendLog('error', msg);
                throw new Error(msg);
            }

            // 2) Connect to LiveKit using Room instance
            const newRoom = new Room();
            await newRoom.connect(values.serverUrl, token, {
                autoSubscribe: true,
            });

            appendLog(
                'info',
                `Connected to LiveKit room "${values.roomName}" as "${values.identity}".`
            );

            // 3) Publish a local audio track so we have a real WebRTC peer connection
            try {
                const audioTrack = await createLocalAudioTrack();
                await newRoom.localParticipant.publishTrack(audioTrack);
                appendLog('info', 'Published local audio track (microphone).');
            } catch (pubErr: any) {
                console.warn('Could not publish local audio track:', pubErr);
                appendLog(
                    'warn',
                    `Could not publish local audio track: ${pubErr?.message ?? String(pubErr)}`
                );
            }

            setRoom(newRoom);
            setConnectionState(newRoom.state);
            setError(null);
        } catch (err: any) {
            console.error('Connection error:', err);
            const msg = err?.message || 'Failed to connect to LiveKit';
            setError(msg);
            setConnectionState(ConnectionState.Disconnected);
            appendLog('error', `Connection error: ${msg}`);
        } finally {
            setIsConnecting(false);
        }
    };

    // Track room events (connection state, participants)
    useEffect(() => {
        if (!room) {
            return;
        }

        const handleStateChanged = (state: ConnectionState) => {
            setConnectionState(state);
            appendLog('info', `Connection state changed → ${state}`);
        };

        const recomputeParticipants = () => {
            setParticipantsCount(room.numParticipants);
            appendLog('info', `Participant count updated → ${room.numParticipants}`);
        };

        const handleParticipantConnected = () => {
            appendLog('info', 'Remote participant connected.');
            recomputeParticipants();
        };

        const handleParticipantDisconnected = () => {
            appendLog('info', 'Remote participant disconnected.');
            recomputeParticipants();
        };

        room.on(RoomEvent.ConnectionStateChanged, handleStateChanged);
        room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
        room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

        // Initial compute
        recomputeParticipants();

        return () => {
            room.off(RoomEvent.ConnectionStateChanged, handleStateChanged);
            room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
            room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
        };
    }, [room, appendLog]);

    // Periodically pull WebRTC stats (SDK API if available, otherwise raw RTCPeerConnection stats)
    useEffect(() => {
        if (!room) {
            setStatsJson(null);
            setWebrtcSummary(null);
            return;
        }

        let cancelled = false;

        const updateStats = async () => {
            try {
                const anyRoom = room as any;

                // 1) Preferred: SDK-level stats if available in this version
                if (typeof anyRoom.getStats === 'function') {
                    const stats = await anyRoom.getStats();
                    if (cancelled) return;

                    setStatsJson(JSON.stringify(stats, null, 2));
                    // Unknown structure; skip summary to avoid wrong parsing
                    return;
                }

                // 2) Fallback: try to find any RTCPeerConnection inside engine
                const engine = anyRoom.engine;
                const pcs: RTCPeerConnection[] = [];

                const collectPcs = (obj: any) => {
                    if (!obj || typeof obj !== 'object') return;

                    // Direct RTCPeerConnection (heuristic: getStats + createDataChannel)
                    if (
                        typeof (obj as RTCPeerConnection).getStats === 'function' &&
                        typeof (obj as RTCPeerConnection).createDataChannel === 'function'
                    ) {
                        pcs.push(obj as RTCPeerConnection);
                        return;
                    }

                    // Common patterns: obj.pc / obj.peerConnection
                    if (obj.pc && typeof obj.pc.getStats === 'function') {
                        pcs.push(obj.pc as RTCPeerConnection);
                    }
                    if (obj.peerConnection && typeof obj.peerConnection.getStats === 'function') {
                        pcs.push(obj.peerConnection as RTCPeerConnection);
                    }

                    // Recurse into nested objects (shallow-ish to avoid huge graphs)
                    for (const value of Object.values(obj)) {
                        if (value && typeof value === 'object') {
                            collectPcs(value);
                        }
                    }
                };

                collectPcs(engine);

                if (pcs.length === 0) {
                    if (!cancelled) {
                        setStatsJson('WebRTC stats not available yet (no RTCPeerConnection found).');
                        setWebrtcSummary(null);
                    }
                    return;
                }

                const results: any[] = [];
                let index = 0;
                for (const pc of pcs) {
                    const report = await pc.getStats();
                    const items: any[] = [];
                    report.forEach((v: any) => items.push(v));
                    results.push({ peer: `pc-${index}`, stats: items });
                    index += 1;
                }

                if (cancelled) return;

                setStatsJson(JSON.stringify(results, null, 2));
                setWebrtcSummary(computeWebRtcSummary(results));
            } catch (err: any) {
                console.error('Failed to get stats from room:', err);
                if (!cancelled) {
                    setStatsJson(`Error reading stats: ${err?.message ?? String(err)}`);
                    setWebrtcSummary(null);
                }
            }
        };

        updateStats();
        const intervalId = window.setInterval(updateStats, 5000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [room]);

    // Cleanup room when leaving page / hot reload
    useEffect(() => {
        return () => {
            if (room) {
                room.disconnect();
            }
        };
    }, [room]);

    const buildDebugSnapshot = () => {
        return {
            generatedAt: new Date().toISOString(),
            connection: {
                state: connectionState,
                lastAttempt: lastConnectionAttempt,
                participantsCount,
            },
            webrtc: webrtcSummary,
            logs,
        };
    };

    const handleCopySnapshot = async () => {
        try {
            const snapshot = buildDebugSnapshot();
            const text = JSON.stringify(snapshot, null, 2);
            await navigator.clipboard.writeText(text);
            appendLog('info', 'Copied debug snapshot to clipboard.');
            alert('Debug snapshot copied to clipboard.');
        } catch (err: any) {
            console.error('Failed to copy snapshot:', err);
            appendLog(
                'error',
                `Failed to copy debug snapshot: ${err?.message ?? String(err)}`
            );
        }
    };

    const formatBytes = (value: number | null) => {
        if (value == null) return '—';
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    };

    const formatPackets = (value: number | null) => {
        if (value == null) return '—';
        return value.toString();
    };

    const formatRtt = (value: number | null) => {
        if (value == null) return '—';
        return `${Math.round(value)} ms`;
    };

    return (
        <div style={styles.page}>
            <header style={styles.header}>
                <h1>LiveKit Troubleshooting Playground</h1>
                <p style={styles.subtitle}>
                    Step 7: Event log console and basic WebRTC stats.
                </p>
            </header>

            <main style={styles.main}>
                <section style={styles.card}>
                    <h2>Connection settings</h2>
                    <p style={styles.cardText}>
                        Enter your LiveKit server URL, room name, and identity. The Connect button will request
                        a token from the local token server and then join the specified room.
                    </p>
                    <ConnectionForm onSubmit={handleConnect} />
                    {isConnecting && <p style={styles.infoText}>Connecting…</p>}
                </section>

                <section style={styles.card}>
                    <div style={styles.debugHeaderRow}>
                        <h2 style={{ margin: 0 }}>Debug info</h2>
                        <button
                            type="button"
                            style={styles.snapshotButton}
                            onClick={handleCopySnapshot}
                        >
                            Copy debug snapshot
                        </button>
                    </div>
                    <p style={styles.cardText}>
                        This panel shows the latest connection attempt, connection state, participant count, a
                        rolling event log, and WebRTC stats useful for deeper debugging.
                    </p>

                    <div style={styles.debugRow}>
                        <div>
                            <div style={styles.debugLabel}>Connection state</div>
                            <div style={styles.debugValue}>{connectionState}</div>
                        </div>
                        <div>
                            <div style={styles.debugLabel}>Participants</div>
                            <div style={styles.debugValue}>{participantsCount}</div>
                        </div>
                    </div>

                    {error && (
                        <div style={styles.errorBox}>
                            <strong>Error:</strong> {error}
                        </div>
                    )}

                    {/* WebRTC health summary */}
                    <h3 style={{ marginTop: '1rem', fontSize: '0.9rem' }}>WebRTC health</h3>
                    <div style={styles.healthGrid}>
                        <div>
                            <div style={styles.healthLabel}>ICE state</div>
                            <div style={styles.healthValue}>
                                {webrtcSummary?.iceState ?? '—'}
                            </div>
                        </div>
                        <div>
                            <div style={styles.healthLabel}>DTLS state</div>
                            <div style={styles.healthValue}>
                                {webrtcSummary?.dtlsState ?? '—'}
                            </div>
                        </div>
                        <div>
                            <div style={styles.healthLabel}>RTT</div>
                            <div style={styles.healthValue}>
                                {formatRtt(webrtcSummary?.rttMs ?? null)}
                            </div>
                        </div>
                        <div>
                            <div style={styles.healthLabel}>Bytes sent</div>
                            <div style={styles.healthValue}>
                                {formatBytes(webrtcSummary?.bytesSent ?? null)}
                            </div>
                        </div>
                        <div>
                            <div style={styles.healthLabel}>Bytes received</div>
                            <div style={styles.healthValue}>
                                {formatBytes(webrtcSummary?.bytesReceived ?? null)}
                            </div>
                        </div>
                        <div>
                            <div style={styles.healthLabel}>Packets sent</div>
                            <div style={styles.healthValue}>
                                {formatPackets(webrtcSummary?.packetsSent ?? null)}
                            </div>
                        </div>
                        <div>
                            <div style={styles.healthLabel}>Packets received</div>
                            <div style={styles.healthValue}>
                                {formatPackets(webrtcSummary?.packetsReceived ?? null)}
                            </div>
                        </div>
                    </div>

                    <h3 style={{ marginTop: '1rem', fontSize: '0.9rem' }}>Last connection payload</h3>
                    <pre style={styles.pre}>
            {lastConnectionAttempt
                ? JSON.stringify(lastConnectionAttempt, null, 2)
                : 'No connection attempts yet.'}
          </pre>

                    <h3 style={{ marginTop: '1rem', fontSize: '0.9rem' }}>WebRTC stats (auto-refreshing)</h3>
                    <pre style={styles.pre}>
            {statsJson ?? 'Stats will appear here after connecting to a room.'}
          </pre>

                    <LogsView logs={logs} onClear={() => setLogs([])} />
                </section>
            </main>
        </div>
    );
}

function computeWebRtcSummary(results: any[]): WebRtcSummary | null {
    // results: [{ peer: 'pc-0', stats: [...] }, ...]
    if (!Array.isArray(results) || results.length === 0) return null;

    const allStats: any[] = [];
    for (const entry of results) {
        if (entry && Array.isArray(entry.stats)) {
            allStats.push(...entry.stats);
        }
    }
    if (allStats.length === 0) return null;

    const candidatePairs = allStats.filter((s) => s.type === 'candidate-pair');
    const transports = allStats.filter((s) => s.type === 'transport');

    const selectedPair =
        candidatePairs.find((s) => s.nominated && s.state === 'succeeded') ||
        candidatePairs.find((s) => s.state === 'succeeded') ||
        candidatePairs[0];

    const transport = transports[0];

    const rttMs =
        selectedPair && typeof selectedPair.currentRoundTripTime === 'number'
            ? selectedPair.currentRoundTripTime * 1000
            : null;

    const bytesSent =
        (transport && typeof transport.bytesSent === 'number' && transport.bytesSent) ??
        (selectedPair && typeof selectedPair.bytesSent === 'number' && selectedPair.bytesSent) ??
        null;

    const bytesReceived =
        (transport && typeof transport.bytesReceived === 'number' && transport.bytesReceived) ??
        (selectedPair && typeof selectedPair.bytesReceived === 'number' && selectedPair.bytesReceived) ??
        null;

    const packetsSent =
        (transport && typeof transport.packetsSent === 'number' && transport.packetsSent) ??
        (selectedPair && typeof selectedPair.packetsSent === 'number' && selectedPair.packetsSent) ??
        null;

    const packetsReceived =
        (transport && typeof transport.packetsReceived === 'number' && transport.packetsReceived) ??
        (selectedPair && typeof selectedPair.packetsReceived === 'number' && selectedPair.packetsReceived) ??
        null;

    return {
        iceState: (transport && transport.iceState) || null,
        dtlsState: (transport && transport.dtlsState) || null,
        rttMs,
        bytesSent,
        bytesReceived,
        packetsSent,
        packetsReceived,
    };
}

const styles: { [key: string]: React.CSSProperties } = {
    page: {
        minHeight: '100vh',
        padding: '2rem',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: '#0f172a',
        color: '#e5e7eb',
    },
    header: {
        maxWidth: 900,
        margin: '0 auto 2rem auto',
    },
    subtitle: {
        marginTop: '0.5rem',
        color: '#9ca3af',
        fontSize: '0.95rem',
    },
    main: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
        gap: '1.5rem',
        alignItems: 'flex-start',
    },
    card: {
        background: '#020617',
        borderRadius: 12,
        padding: '1.5rem',
        boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
        border: '1px solid #1f2937',
    },
    cardText: {
        color: '#9ca3af',
        fontSize: '0.9rem',
        marginBottom: '1rem',
    },
    pre: {
        marginTop: '0.5rem',
        padding: '0.75rem',
        background: '#020617',
        borderRadius: 8,
        border: '1px solid #111827',
        fontSize: '0.8rem',
        overflowX: 'auto',
    },
    debugRow: {
        display: 'flex',
        gap: '2rem',
        marginBottom: '0.75rem',
    },
    debugLabel: {
        fontSize: '0.8rem',
        color: '#9ca3af',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
    },
    debugValue: {
        marginTop: '0.15rem',
        fontSize: '1rem',
        fontWeight: 600,
    },
    errorBox: {
        marginTop: '0.5rem',
        padding: '0.5rem 0.75rem',
        borderRadius: 8,
        border: '1px solid #ef4444',
        background: 'rgba(239, 68, 68, 0.1)',
        fontSize: '0.85rem',
    },
    infoText: {
        marginTop: '0.5rem',
        fontSize: '0.85rem',
        color: '#93c5fd',
    },
    healthGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '0.75rem',
        marginTop: '0.5rem',
        marginBottom: '0.5rem',
        fontSize: '0.8rem',
    },
    healthLabel: {
        color: '#9ca3af',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontSize: '0.7rem',
    },
    healthValue: {
        marginTop: '0.1rem',
        fontWeight: 600,
    },
    debugHeaderRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.75rem',
    },
    snapshotButton: {
        padding: '0.35rem 0.75rem',
        borderRadius: 999,
        border: '1px solid #4b5563',
        background: '#020617',
        color: '#e5e7eb',
        fontSize: '0.75rem',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    },
};

export default App;
