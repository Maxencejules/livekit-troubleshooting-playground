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

import { useState, type FormEvent } from 'react';
import type { ConnectionSettings } from '../src/session';

export function ConnectionForm({ onSubmit, busy }: { onSubmit: (settings: ConnectionSettings) => void; busy: boolean }) {
  const [serverUrl, setServerUrl] = useState('');
  const [roomName, setRoomName] = useState('support-room');
  const [identity, setIdentity] = useState('developer');
  const [publishMicrophone, setPublishMicrophone] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit({ serverUrl, roomName, identity, publishMicrophone }); };
  return <form onSubmit={submit}>
    <label>LiveKit server URL<input type="text" value={serverUrl} onChange={event => setServerUrl(event.target.value)} placeholder="ws://127.0.0.1:7880" maxLength={2048} required disabled={busy} /></label>
    <label>Room name<input value={roomName} onChange={event => setRoomName(event.target.value)} maxLength={100} required disabled={busy} /></label>
    <label>Identity<input value={identity} onChange={event => setIdentity(event.target.value)} maxLength={100} required disabled={busy} /></label>
    <label className="checkbox"><input type="checkbox" checked={publishMicrophone} onChange={event => setPublishMicrophone(event.target.checked)} disabled={busy} />Publish microphone (asks for permission after connecting)</label>
    <button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
  </form>;
}
