# Offline check record

Observed locally on 2026-09-29/30 with Windows, Node 24.12.0, npm 11.11.1, LiveKit client 2.16.0/server SDK 2.15.0, Vitest 5.0.2, Playwright CLI 0.1.22 and headless Chromium 155. The screenshot is **synthetic fixture output**, not evidence of a real room's behavior.

Start the two local processes using the root README. Keep `server/.env` absent for the missing-credentials check. These actions are reproducible through the UI; element references in browser automation must be obtained from a fresh snapshot each run.

| Action | Observed result |
| --- | --- |
| Selected pair | 25 ms STUN RTT; 10,000/12,000 bytes; 12,800 bit/s in both directions. The misleading nominated pair's 9 s RTT was ignored. |
| High RTT | 900 ms with the observation-threshold notice and no quality diagnosis. |
| Missing fields | Pair reference and all absent state/counter/RTT values shown as Unavailable. |
| Counter reset | Real zero counters; unavailable rates; explicit reset notice. |
| Enter `https://127.0.0.1:7880`, Connect | URL validation error without a token request. |
| Enter `ws://127.0.0.1:7880`, Connect without credentials | Local `POST /api/token` returned 503; fixed configuration error; disconnected, microphone off. No LiveKit connection was created. |
| Enter distinct room/identity marker strings, select a fixture, Copy and Download | Both JSON payloads parsed as schema 1, mode fixture, RTT 25 ms. The room, identity and endpoint markers were absent. Clipboard was 2,464 UTF-8 bytes; download 2,385 bytes (Windows clipboard line endings differ). |
| Desktop 1280×1000 and narrow 390×844 viewports | Full-page screenshots visually checked; fields and controls readable. At the narrow viewport, document scroll width was 390 px, with no horizontal overflow. |

The browser's only error-level console entry was the deliberately tested local 503 response. Fixtures did not request a token or access the microphone. Clipboard read/write permissions were granted only to the isolated test browser context.

The desktop preview is committed as [offline-desktop.png](offline-desktop.png). Local screenshots, snapshots, the downloaded JSON and browser configuration are ignored in `output/` and `.local/`; they are not needed to run the application.

Automated proof: 55 client cases and 17 Node HTTP/JWT cases, strict TypeScript/Vite build, ESLint and server syntax checks. Vite emits a bundle-size notice for the approximately 610 kB minified JavaScript bundle (169 kB gzip), which includes the LiveKit SDK. This is a performance limitation, not a failed build.

No real LiveKit server, cloud room, microphone device, Firefox or Safari was exercised. Public API typing, mock SDK adapter tests, deterministic stats fixtures and loopback HTTP tests establish the bounded local behavior; they do not establish interoperability with every browser or deployment.
