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


// client/src/components/ConnectionForm.tsx
import React, { useState, type FormEvent } from 'react';

export interface ConnectionFormValues {
    serverUrl: string;
    roomName: string;
    identity: string;
}

interface ConnectionFormProps {
    initialValues?: Partial<ConnectionFormValues>;
    onSubmit: (values: ConnectionFormValues) => void;
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({
                                                                  initialValues,
                                                                  onSubmit,
                                                              }) => {
    const [serverUrl, setServerUrl] = useState(initialValues?.serverUrl ?? '');
    const [roomName, setRoomName] = useState(initialValues?.roomName ?? 'support-room');
    const [identity, setIdentity] = useState(initialValues?.identity ?? 'maxence-dev');

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        onSubmit({ serverUrl, roomName, identity });
    };

    return (
        <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.fieldGroup}>
                <label style={styles.label}>
                    LiveKit server URL
                    <input
                        style={styles.input}
                        type="text"
                        placeholder="wss://your-project.livekit.cloud"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        required
                    />
                </label>
            </div>

            <div style={styles.fieldGroup}>
                <label style={styles.label}>
                    Room name
                    <input
                        style={styles.input}
                        type="text"
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        required
                    />
                </label>
            </div>

            <div style={styles.fieldGroup}>
                <label style={styles.label}>
                    Identity
                    <input
                        style={styles.input}
                        type="text"
                        value={identity}
                        onChange={(e) => setIdentity(e.target.value)}
                        required
                    />
                </label>
            </div>

            <button type="submit" style={styles.button}>
                Connect
            </button>
        </form>
    );
};

const styles: { [key: string]: React.CSSProperties } = {
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        maxWidth: '480px',
    },
    fieldGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
    },
    label: {
        fontSize: '0.9rem',
        fontWeight: 500,
    },
    input: {
        padding: '0.5rem 0.75rem',
        borderRadius: 6,
        border: '1px solid #ccc',
        fontSize: '0.95rem',
    },
    button: {
        marginTop: '0.5rem',
        padding: '0.6rem 1rem',
        borderRadius: 6,
        border: 'none',
        background: '#2563eb',
        color: '#fff',
        fontSize: '0.95rem',
        fontWeight: 600,
        cursor: 'pointer',
    },
};
