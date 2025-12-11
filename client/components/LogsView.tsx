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


import React from 'react';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
    id: number;
    timestamp: string;
    level: LogLevel;
    message: string;
}

interface LogsViewProps {
    logs: LogEntry[];
    onClear: () => void;
}

export const LogsView: React.FC<LogsViewProps> = ({ logs, onClear }) => {
    return (
        <div style={styles.container}>
            <div style={styles.headerRow}>
                <span style={styles.title}>Event log</span>
                <button type="button" style={styles.clearButton} onClick={onClear}>
                    Clear
                </button>
            </div>
            <div style={styles.logList}>
                {logs.length === 0 ? (
                    <div style={styles.empty}>No events yet.</div>
                ) : (
                    logs.map((log) => (
                        <div key={log.id} style={rowStyleForLevel(log.level)}>
              <span style={styles.time}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
                            <span style={styles.level}>{log.level.toUpperCase()}</span>
                            <span>{log.message}</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

const styles: { [key: string]: React.CSSProperties } = {
    container: {
        marginTop: '1rem',
        borderTop: '1px solid #111827',
        paddingTop: '0.75rem',
    },
    headerRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '0.5rem',
    },
    title: {
        fontSize: '0.85rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: '#9ca3af',
    },
    clearButton: {
        padding: '0.2rem 0.6rem',
        borderRadius: 999,
        border: '1px solid #4b5563',
        background: 'transparent',
        color: '#e5e7eb',
        fontSize: '0.75rem',
        cursor: 'pointer',
    },
    logList: {
        maxHeight: 220,
        overflowY: 'auto',
        fontSize: '0.8rem',
        display: 'flex',
        flexDirection: 'column-reverse', // newest at top visually
        gap: '0.25rem',
    },
    row: {
        display: 'grid',
        gridTemplateColumns: '70px 60px 1fr',
        gap: '0.5rem',
        alignItems: 'baseline',
        padding: '0.2rem 0.4rem',
        borderRadius: 4,
    },
    time: {
        color: '#9ca3af',
        fontVariantNumeric: 'tabular-nums',
    },
    level: {
        fontWeight: 600,
        fontSize: '0.75rem',
    },
    empty: {
        color: '#6b7280',
        fontStyle: 'italic',
    },
};

function rowStyleForLevel(level: LogLevel): React.CSSProperties {
    const base = { ...styles.row } as React.CSSProperties;
    if (level === 'info') {
        base.backgroundColor = 'rgba(37, 99, 235, 0.08)';
    } else if (level === 'warn') {
        base.backgroundColor = 'rgba(245, 158, 11, 0.12)';
    } else if (level === 'error') {
        base.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    }
    return base;
}
