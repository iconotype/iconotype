# Spike 02 — Svelte 5 inside a VSCode webview

**Question:** does one Svelte 5 app run in a VSCode webview under a strict CSP, with theme integration, host RPC, and the browser APIs our core needs (wasm, workers, OffscreenCanvas, data: URIs)?

**Verdict: YES.** Real VSCode **1.134.0**, real webview, 15 runtime probes + an extension⇄webview RPC round-trip, run twice — once under a maximally strict CSP, once relaxed.

```bash
npx vite build && node src/test/runTest.js
```

## The CSP to ship

Two relaxations are **mandatory**, proven by the strict run failing without them:

```js
const csp = [
  `default-src 'none'`,
  `img-src ${webview.cspSource} data: blob:`,
  `style-src ${webview.cspSource}`,              // ← NO 'unsafe-inline' needed
  `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`, // ← wasm requires this
  `font-src ${webview.cspSource}`,
  `connect-src ${webview.cspSource} blob: data:`,
  `worker-src blob:`,                            // ← blob workers require this
].join('; ') + ';'
```

## Findings

### 1. Svelte 5 needs **no** `'unsafe-inline'` for styles
The strict run passed styling outright. Component CSS is emitted as a linked `.css` file (no inline `<style>` in the built HTML at all), and Svelte 5 transitions use the **Web Animations API**, not injected `@keyframes`:

```
PASS  svelte transition runs under strict style-src
      WAAPI animations=1, runtime <style> injected=false → no unsafe-inline needed
```

That is better than the CSP most VSCode extensions ship. Keep it — and add a build check that fails if any inline `<style>` or inline script appears in the output.

### 2. `'wasm-unsafe-eval'` is required — this gates WOFF2
Under strict CSP:
```
WebAssembly.instantiate(): Compiling or instantiating WebAssembly module violates
the following Content Security policy directive because 'unsafe-eval' is not an
allowed source of script … "script-src 'nonce-…'"
```
`woff2-encoder` is wasm, so **no `wasm-unsafe-eval` = no WOFF2 in the webview**. With it, wasm instantiates fine.

### 3. `worker-src blob:` is required for blob workers
Strict run: `worker blocked`. Relaxed: `echo 42`. Needed to move font building and batch SVG fixing off the UI thread.

### 4. ⚠️ Relative `fetch()` does not reach extension resources — 403
```
FAIL  fetch() relative URL          status 403
PASS  fetch() via asWebviewUri base {"asset":"loaded via asWebviewUri"}
```
Relative URLs resolve against the `vscode-webview://` origin, not the extension folder. Every runtime-loaded asset (wasm binary, fonts, icon data) must be fetched through an absolute `asWebviewUri` URL. Pattern used here: the extension injects

```html
<meta name="asset-base" content="${webview.asWebviewUri(distUri)}">
```

and the app reads it once at boot. Same shim point where the web build injects `'/'`.

Corollary: rewrite `src`/`href` in the built `index.html` through `asWebviewUri`, and stamp the nonce onto every `<script>` tag. ~10 lines, in `src/extension.js`.

### 5. Theming works with plain CSS variables
```
PASS  theme CSS vars         #000c18   (--vscode-editor-background)
PASS  theme kind attribute   vscode-dark
PASS  external stylesheet    rgb(43, 60, 93)  (--vscode-button-background applied)
```
No toolkit needed. Use `var(--vscode-*, <fallback>)` throughout the shared UI: the fallback is what the web and Tauri builds render, the variable is what VSCode overrides. **One stylesheet, three hosts.**

### 6. Storage and browser APIs available in the webview
| API | status |
|---|---|
| `localStorage` | available |
| `IndexedDB` | available |
| **OPFS** (`navigator.storage.getDirectory`) | available |
| `OffscreenCanvas` + `convertToBlob` | available (PNG export) |
| `data:` and `blob:` images | available (glyph previews) |
| `structuredClone` incl. `Uint8Array` | available (op-log / font-buffer transfer) |
| webview state API (`getState`/`setState`) | available |

OPFS working means the **web build's storage layer runs unchanged in the webview** — the VSCode build can still prefer `workspace.fs` via the extension host, but there is no forced rewrite.

### 7. RPC round-trip
`extension → panel.webview.postMessage` → app → `vscode.postMessage` → extension: payload echoed intact. This is the `Host` adapter transport from [02-architecture](../docs/02-architecture.md).

Gotcha found while wiring: **`extension.exports` is whatever `activate()` returns** — assigning to `module.exports` inside `activate()` does nothing.

### 8. Size
Svelte 5 app + probes: **43 KB raw / 17 KB gzip.** Framework overhead is negligible next to the 153 KB gzip geometry/font core.

## Consequences for the plan
- "One Svelte UI in three shells" is **de-risked**; CSP is settled up front instead of biting in M5.
- Lock the shipping CSP now and put both webview builds (strict-style, wasm+worker relaxed) under test from M0.
- Add a build assertion: no inline `<style>`/`<script>` in webview output.
- Asset loading goes through one `assetBase()` shim from day one — VSCode is the only host that needs it, and it is the one that fails silently without it.
