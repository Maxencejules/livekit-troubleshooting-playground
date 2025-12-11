import React, { useState } from 'react';
import { ConnectionForm, type ConnectionFormValues } from "../components/ConnectionForm";

function App() {
    const [lastConnectionAttempt, setLastConnectionAttempt] =
        useState<ConnectionFormValues | null>(null);

    const handleConnect = (values: ConnectionFormValues) => {
        setLastConnectionAttempt(values);
        // LiveKit connection will be implemented in the next step.
        console.log('Connect requested with:', values);
    };

    return (
        <div style={styles.page}>
            <header style={styles.header}>
                <h1>LiveKit Troubleshooting Playground</h1>
                <p style={styles.subtitle}>
                    Step 3: basic connection form (LiveKit wiring will come next).
                </p>
            </header>

            <main style={styles.main}>
                <section style={styles.card}>
                    <h2>Connection settings</h2>
                    <p style={styles.cardText}>
                        Enter your LiveKit server URL, room name, and identity.
                        The Connect button currently logs the values and will be wired to
                        the LiveKit SDK in a later step.
                    </p>
                    <ConnectionForm onSubmit={handleConnect} />
                </section>

                <section style={styles.card}>
                    <h2>Debug info</h2>
                    <p style={styles.cardText}>
                        This panel will eventually show connection state, participants, and
                        WebRTC stats. For now, it just echoes the latest form values.
                    </p>
                    <pre style={styles.pre}>
            {lastConnectionAttempt
                ? JSON.stringify(lastConnectionAttempt, null, 2)
                : 'No connection attempts yet.'}
          </pre>
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
};

export default App;
