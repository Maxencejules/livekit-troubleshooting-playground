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

import { useEffect, useRef, useState } from 'react';
import { ConnectionForm } from '../components/ConnectionForm';
import { LogsView } from '../components/LogsView';
import { fixture, fixtureNames, type FixtureName } from './fixtures';
import { LiveKitSession, requestToken } from './livekit';
import { initialView, SessionController, validateSettings, type ConnectionSettings } from './session';
import { eventMessage, snapshotText, type LogEntry } from './snapshot';
import { LIMITS } from './diagnostics';

function App() {
  const [view, setView] = useState(initialView);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [selectedFixture, setSelectedFixture] = useState<FixtureName | null>(null);
  const [now, setNow] = useState(Date.now);
  const controller = useRef<SessionController | null>(null);

  useEffect(() => {
    const session = new SessionController({
      createRoom: () => new LiveKitSession(), requestToken, onView: setView,
      onEvent: code => setLogs(previous => [...previous, { timestamp: new Date().toISOString(), code }].slice(-LIMITS.logs)),
    });
    controller.current = session;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(clock); session.dispose(); if (controller.current === session) controller.current = null; };
  }, []);

  const connect = (settings: ConnectionSettings) => {
    setFeedback('');
    try {
      const valid = validateSettings(settings);
      setFormError(''); setSelectedFixture(null);
      void controller.current?.connect(valid);
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Check the connection settings.'); }
  };
  const loadFixture = (name: FixtureName) => {
    setFormError(''); setFeedback(''); setSelectedFixture(name);
    void controller.current?.fixture(fixture(name, now));
  };
  const text = snapshotText({ ...view, logs }, now);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setFeedback('Redacted snapshot copied.'); }
    catch { setFeedback('Clipboard unavailable. Use Download snapshot instead.'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'livekit-diagnostics.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setFeedback('Redacted snapshot downloaded.');
  };
  const busy = ['requesting-token', 'connecting', 'reconnecting'].includes(view.phase) || view.microphone === 'pending';
  const active = view.mode === 'live' && !['idle', 'disconnected'].includes(view.phase);
  const age = view.diagnostics ? Math.max(0, (now - Date.parse(view.diagnostics.sampledAt)) / 1000) : null;
  const stale = view.mode === 'live' && age !== null && age > 12;

  return (
    <div className="page">
      <header>
        <p className="eyebrow">Developer support lab</p>
        <h1>LiveKit troubleshooting playground</h1>
        <p className="subtitle">Inspect observable transport signals. Reproduce edge cases offline. Share a redacted support snapshot.</p>
      </header>
      <main className="layout">
        <section className="card">
          <h2>Connect a developer room</h2>
          <p>Tokens come from your local issuer. Microphone capture is off until you opt in.</p>
          <ConnectionForm onSubmit={connect} busy={busy} />
          <button className="secondary" disabled={!active} onClick={() => { setSelectedFixture(null); void controller.current?.stop(); }}>Cancel / Disconnect</button>
          {(formError || view.error) && <p className="notice error" role="alert">{formError || (view.error && eventMessage(view.error))}</p>}
          <div className="session" aria-live="polite">
            <div><span>Session</span><strong>{view.mode === 'fixture' ? 'Offline fixture' : view.phase}</strong></div>
            <div><span>Participants</span><strong>{view.participants ?? 'Unavailable'}</strong></div>
            <div><span>Microphone</span><strong>{view.microphone}</strong></div>
          </div>
        </section>

        <section className="card">
          <h2>Offline scenarios</h2>
          <p>Deterministic synthetic stats, including a misleading nominated pair. No token, room connection or microphone is used.</p>
          <div className="fixture-buttons">
            {fixtureNames.map(name => <button key={name} className="secondary" aria-pressed={selectedFixture === name} onClick={() => loadFixture(name)}>{name}</button>)}
          </div>
          <p className="notice">{selectedFixture ? `Fixture: ${selectedFixture}. These values are simulated.` : 'Choose a scenario to explore diagnostics without credentials.'}</p>
          <p className="muted">A fixture cancels an active developer session. A new connection clears the fixture.</p>
        </section>

        <section className="card wide">
          <div className="section-heading"><h2>Transport observations</h2><span className={stale ? 'badge warning' : 'badge'}>{view.mode === 'fixture' ? 'Simulated' : stale ? 'Stale sample' : 'Live mode'}</span></div>
          <p>Track-scoped reports can share a transport. Counters are cumulative and are never summed across tracks. STUN RTT is not end-to-end media latency.</p>
          {age !== null && <p className="muted">Last successful sample: {Math.floor(age)} s ago ({view.diagnostics?.sampledAt}). {view.mode === 'live' && 'Polling every 5 s after the previous read completes.'}</p>}
          {view.statsFailed && <p className="notice warning" role="status">Stats read failed. The previous sample is retained and may be stale.</p>}
          {view.diagnostics?.truncated && <p className="notice warning">Collection was truncated to the documented safety limits.</p>}
          {!view.diagnostics?.sources.length && <p className="empty">No track reports available. Connect and publish or subscribe to a media track, or choose an offline fixture.</p>}
          <div className="observations">
            {view.diagnostics?.sources.map(source => <article className="track" key={source.label}>
              <h3>{source.label} · {source.direction} {source.kind}</h3>
              {!source.transports.length && <p>Transport fields unavailable in this track report.</p>}
              {source.transports.map(transport => <div key={transport.label}>
                <p className="muted">{transport.label} · selected pair {transport.selectedPairAvailable ? 'referenced' : 'unavailable'}</p>
                <dl>
                  <div><dt>ICE state</dt><dd>{transport.iceState ?? 'Unavailable'}</dd></div>
                  <div><dt>DTLS state</dt><dd>{transport.dtlsState ?? 'Unavailable'}</dd></div>
                  <div><dt>STUN RTT</dt><dd>{format(transport.stunRttMs, 'ms')}</dd></div>
                  <div><dt>Bytes sent / received</dt><dd>{format(transport.bytesSent)} / {format(transport.bytesReceived)}</dd></div>
                  <div><dt>Send / receive rate</dt><dd>{format(transport.sentBitsPerSecond, 'bit/s')} / {format(transport.receivedBitsPerSecond, 'bit/s')}</dd></div>
                  <div><dt>Counter scope</dt><dd>{transport.counterSource ?? 'Unavailable'}</dd></div>
                </dl>
                {transport.counterReset && <p className="notice warning">Counter reset observed; rates are unavailable for this interval.</p>}
                {transport.stunRttMs !== null && transport.stunRttMs > 300 && <p className="notice warning">STUN RTT exceeds the 300 ms observation threshold. This alone does not diagnose media quality.</p>}
                {(transport.iceState === 'failed' || transport.dtlsState === 'failed') && <p className="notice warning">The browser reported a failed transport state. This does not identify its cause.</p>}
              </div>)}
            </article>)}
          </div>
        </section>

        <section className="card wide">
          <div className="section-heading"><h2>Support snapshot</h2><div className="actions"><button className="secondary" onClick={() => void copy()}>Copy snapshot</button><button onClick={download}>Download snapshot</button></div></div>
          <p>Exports contain only bounded observations and fixed event codes. Room names, identities, endpoints, tokens, addresses, SDP and raw SDK errors are omitted.</p>
          <p className="feedback" role="status">{feedback}</p>
          <details><summary>Preview redacted JSON</summary><pre>{text}</pre></details>
          <LogsView logs={logs} onClear={() => setLogs([])} />
        </section>
      </main>
      <footer>Local troubleshooting prototype · Browser fields vary · No cloud room was used to generate the fixture examples</footer>
    </div>
  );
}
function format(value: number | null, unit = '') { return value === null ? 'Unavailable' : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}`; }
export default App;
