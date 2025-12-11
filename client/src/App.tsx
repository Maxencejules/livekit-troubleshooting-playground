import React, { useEffect, useState, useCallback } from 'react';
import { ConnectionForm, type ConnectionFormValues } from '../components/ConnectionForm';
import { Room, RoomEvent, ConnectionState } from 'livekit-client';
import { LogsView, type LogEntry, type LogLevel } from '../components/LogsView';

type ExtendedConnectionState = ConnectionState | 'idle';

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

    // Cleanup room when leaving page / hot reload
    useEffect(() => {
        return () => {
            if (room) {
                room.disconnect();
            }
        };
    }, [room]);

    return (
        <div style={styles.page}>
            <header style={styles.header}>
                <h1>LiveKit Troubleshooting Playground</h1>
                <p style={styles.subtitle}>
                    Step 6: Event log console for connection and participant events.
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
                    <h2>Debug info</h2>
                    <p style={styles.cardText}>
                        This panel shows the latest connection attempt, connection state, participant count, and
                        a rolling event log suitable for debugging issues.
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

                    <h3 style={{ marginTop: '1rem', fontSize: '0.9rem' }}>Last connection payload</h3>
                    <pre style={styles.pre}>
            {lastConnectionAttempt
                ? JSON.stringify(lastConnectionAttempt, null, 2)
                : 'No connection attempts yet.'}
          </pre>

                    <LogsView logs={logs} onClear={() => setLogs([])} />
                </section>
            </main>
        </div>
    );
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
};

export default App;
