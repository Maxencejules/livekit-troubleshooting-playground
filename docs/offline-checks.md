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

## Dependency refresh

The 2026-09-30 UTC rerun used stable Vite 8.3.1 with `@vitejs/plugin-react` 6.1.1 and ESLint 10.11.0. The old `rolldown-vite` alias and override were removed following the [official Vite migration guide](https://vite.dev/guide/migration.html); ESLint 9 had reached end of life under the [official support policy](https://eslint.org/version-support/). The React and LiveKit runtime versions and application sources are unchanged.

Compatible lockfile updates include the server's body-parser 2.3.0, qs 6.16.0 and path-to-regexp 8.4.2. These address the [body-parser limit advisory](https://github.com/expressjs/body-parser/security/advisories/GHSA-v422-hmwv-36x6) and [path-to-regexp optional-group advisory](https://github.com/pillarjs/path-to-regexp/security/advisories/GHSA-j3q9-mxjg-w52f), along with the qs advisories reported by npm. Express remains 5.2.1.

Fresh `npm ci` at the root, client and server succeeded. All 55 client and 17 server tests, lint and the strict production build passed again. Full `npm audit --json` runs, including development dependencies, reported **0 low, 0 moderate, 0 high and 0 critical findings** for both client and server. This records the advisory registry at the time of the run; it is not a claim that dependencies can never have vulnerabilities. CI now fails on any reported advisory using `--audit-level=low`.

The Vite 8 bundle is 609.58 kB minified JavaScript / 168.92 kB gzip and retains the bundle-size notice. Fresh Chromium checks repeated all four fixtures, the missing-credentials proxy 503, clipboard/export redaction and desktop/narrow layout. Copied JSON was 2,464 bytes; downloaded JSON was 2,385 bytes; both parsed as schema 1 in fixture mode with the entered room, identity and endpoint markers absent. At 390 px, document scroll width remained 390 px. The built, minified production bundle also loaded through `vite preview` and showed the selected-pair scenario correctly, without a new console error. The only tested error remains the deliberate local 503.

Fresh desktop/narrow screenshots agree with the committed synthetic preview, so its bytes are unchanged. No cloud room or microphone device was used. The named browser and owned local server/dev/preview processes were stopped after verification.
