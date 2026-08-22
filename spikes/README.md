# Spikes

De-risking experiments run before scaffolding. Both questions from [docs/08-roadmap.md](../docs/08-roadmap.md) are now answered — with running code, not opinion.

| # | Question | Verdict |
|---|---|---|
| [01](01-paper-headless/) | `paper.js` geometry with no DOM, in Node + browser, fast and deterministic? | **YES** — 13/13 probes; 0.5 ms/glyph outlining; byte-stable output; 153 KB gzip core |
| [02](02-svelte-vscode-webview/) | Svelte 5 in a real VSCode webview under strict CSP, themed, with wasm + workers? | **YES** — VSCode 1.134.0, 15 probes + RPC; needs exactly two CSP relaxations |

Three concrete traps found, all cheap now and expensive later:

1. `paperjs-offset` imports its own `paper` → alias `paper` → `paper/dist/paper-core.js` everywhere, or every offset call throws.
2. `offsetStroke(p, d)` yields stroke width `2d` → pass `strokeWidth / 2`.
3. Relative `fetch()` inside a webview 403s → all runtime assets need an `asWebviewUri` base.
