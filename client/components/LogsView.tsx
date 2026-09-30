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

import { EVENTS, eventMessage, type LogEntry } from '../src/snapshot';

export function LogsView({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  return <section className="logs">
    <div className="section-heading"><h3>Event log</h3><button className="secondary" onClick={onClear}>Clear events</button></div>
    {!logs.length && <p className="empty">No events yet.</p>}
    <ol>{[...logs].reverse().map((log, index) => <li key={`${log.timestamp}-${index}`} className={EVENTS[log.code][0]}>
      <time dateTime={log.timestamp}>{new Date(log.timestamp).toLocaleTimeString()}</time><span>{eventMessage(log.code)}</span>
    </li>)}</ol>
  </section>;
}
