# 08 — Roadmap

Viewer/fixer first (editor deferred to M5, per decision). Each milestone is shippable.

## M0 — Skeleton ✅ **done**
pnpm workspace, Svelte 5 + Vite, `Host` adapter, project model + op/undo tree, web app shell, Pages + CI workflows.
**Done when:** empty project loads in the browser, deployed URL live. *(Local build renders; the Pages URL goes live on the first push to `main`.)*

Delivered: 8 packages, 26 unit tests, 3 VSCode integration tests against real VSCode 1.134.0, all six spike constraints encoded in code rather than prose.

## M1 — Import & view ✅ **done**
IcoMoon project JSON + `selection.json` + zip import (schema in [06](06-import-export.md)), SVG drag-drop import, virtualized glyph grid, search, selection, set management, project persistence in OPFS.
**Done when:** `alpimaps.json` round-trips — import, view all 25 glyphs across 3 sets, re-export identical.

**Verified**: byte-identical round-trip (`JSON.stringify` equality) plus a real browser run — dropped `alpimaps.json` into the built app, got 3 sets / 25 glyphs, correct codepoints (`directions_walk` = `e910`, multicolor `road-cycling` = `e916+2`), search, selection, undo and OPFS reload all working. See [11-m1-import.md](11-m1-import.md).

## M2 — Font build ✅ **done**
`core-font`: svg2ttf writer, metrics from prefs, codepoint lockfile, SVG/TTF/WOFF/WOFF2, CSS + SCSS vars + demo.html + zip download, licence attribution. Determinism tests.
**Done when:** exported font renders identically to IcoMoon's export of the same project, byte-stable across two builds.

**Verified**: built the font from `alpimaps.json` *in a real browser*, installed it with `FontFace`, and pixel-compared all 24 monochrome glyphs against their source SVGs at 96 px — **0.01 % mean difference** with 1 px tolerance (pure antialiasing), no blank glyphs. Two packages built a second apart are byte-identical. See [12-m2-font.md](12-m2-font.md).
*→ The tool is usable from here.*

## M3 — The fixer ✅ **done**
Full [04](04-svg-normalization.md) pipeline (all 13 stages), lint findings UI, before/after overlay, autofix, batch fix, fixture suite + pixel regression harness.
**Done when:** all 60 fixtures produce valid glyphs, < 1.5% pixel diff vs source.

**Verified**: **75** fixtures, all producing valid geometry; 60 pixel comparisons at **0.005 % mean / 0.098 % max** against a 1.5 % threshold, 52 of them pixel-exact. Browser run: 8 pathological SVGs dropped into the built app all became correct glyphs with findings attached. See [13-m3-fixer.md](13-m3-fixer.md).

## M4 — Exports & CLI ✅ **done**
Export formats (sprite, `<use>`, PNG, favicon, React/Vue/Svelte/Web Component/Elm, `icons.d.ts`, quick-copy panel), format options, `iconotype` CLI (build/lint/fix/diff/scan/info), GitHub Action example.
**Done when:** a repo can regenerate its font in CI with a breaking-change gate.

**Verified**: end-to-end CLI run — built from a folder of SVGs, added an icon (codepoints held), and `diff` caught a moved codepoint with exit 1. Workflow in [examples/icons-ci.yml](../examples/icons-ci.yml). See [14-m4-exports-cli.md](14-m4-exports-cli.md).

## M5 — VSCode extension v1 ✅ **done**
A committed `.iconotype.json` per font, quick export straight to configured paths, autocompletion, inline previews, hover, an icon grid sidebar, a fonts tree, a usage view, and workspace settings for the layout.
**Done when:** open a repo, see icons inline in code, add one from the picker, font rebuilds on save.

**Verified**: 27 integration tests in real VSCode 1.134.0 — discovery, export to `app/fonts` + `app/css`, completion excluding deselected icons, hover, decorations, usage scanning, SVG import and selection round-tripping to disk. Followed by M5.1: the editor now persists its edits, plus diagnostics with quick fixes, rename-with-references, go-to-definition and incremental usage indexing. See [15-m5-vscode.md](15-m5-vscode.md).

## M6 — Tauri desktop ✅ (see [16](16-m6-desktop.md))
Native fs + watch, open/save real files with ⌘O/⌘S, a File/Edit menu bar, drag-drop
from Finder, and a modern palette for the app and the website that the extension does
not share. `.app` builds at 5.6 MB.
**Carried forward:** auto-update and signed installers (both need keys and CI secrets),
and folder-as-project.

## M7 — Glyph editor ✅ (see [17](17-m7-glyph-editor.md))
Em-square canvas with metrics and grid, next/previous stepping, nudge, align to any
edge, scale, rotate, flip, fit, snap, stroke→fill and merge-overlaps — every action one
labelled history step.
**Carried forward:** bézier node editing, boolean ops between shapes, per-glyph history,
pixel preview.

## M8 — Advanced (ongoing)
**Icon library ✅ (see [21](21-icon-library.md))** — search 236 open collections
(334,616 icons) from the app, the extension and the CLI; stroke sets outlined by the
existing fixer, one set per collection, and the licences printed into the generated
stylesheet.

Remaining: COLR/CPAL color fonts, usage scan + subsetting, font-file import, Figma import, normalization presets, optical centering, CSH export.

---

## Sequencing risks

**Both blocking risks are resolved** — see [spikes/](../spikes/). Run: `node spikes/01-paper-headless/spike.mjs`, `node spikes/02-svelte-vscode-webview/src/test/runTest.js`.

| Risk | Status | Outcome |
|---|---|---|
| `paper.js` in a DOM-free context | ✅ **resolved** | Works headless (jsdom/canvas optional, unused). `pathData` in/out only — never `importSVG`/`exportSVG`. 0.5 ms per stroke→outline in Node, 1.35 ms in browser. Output byte-deterministic. Contingency (`polygon-clipping` + hand-rolled offsetting) **dropped**. |
| One Svelte UI in three shells | ✅ **resolved** | Verified in real VSCode 1.134.0: strict `style-src` (no `'unsafe-inline'`), themed via `--vscode-*` vars, RPC round-trip, wasm + blob workers + OffscreenCanvas + OPFS all available. |
| Stroke-to-outline quality | ✅ **de-risked** | Exact on square and moderate stars (0.0% area error); −7.3% on extremely sharp concave corners, which is geometrically correct. Still budget time in M3 for **dasharray** and cap/join edge cases — untested. |
| WOFF2 in the browser | ✅ **resolved** | Wasm instantiates in the webview *provided* CSP has `'wasm-unsafe-eval'`. Confirm bundle size in M2. |
| Codepoint stability | open | Design item, not technical. Lockfile lands in M2. |

### Constraints these spikes impose on M0

1. Alias `paper` → `paper/dist/paper-core.js` in every **bundler** config — otherwise `paperjs-offset` instantiates a second paper and every offset call throws. (−147 KB raw / −49 KB gzip as a bonus.) **Not in vitest/node**: node externalizes deps, so an alias there rewrites our imports but not `paperjs-offset`'s and manufactures the very bug it prevents. Node hosts let both resolve to `paper` natively. Guarded by `packages/core-svg/test/constraints.test.ts`.
2. `PaperOffset.offsetStroke(p, d)` produces stroke width **2d** → always pass `strokeWidth / 2`.
3. Ship this webview CSP, and test both variants from day one:
   `default-src 'none'; img-src ${cspSource} data: blob:; style-src ${cspSource}; script-src 'nonce-…' 'wasm-unsafe-eval'; font-src ${cspSource}; connect-src ${cspSource} blob: data:; worker-src blob:;`
4. All runtime asset loading goes through one `assetBase()` shim — relative `fetch()` 403s inside a webview.
5. Build assertion: no inline `<style>` or `<script>` in webview output (it is what buys the strict `style-src`).
6. `activate()` must **return** the extension API object; assigning `module.exports` inside it does nothing.

### Measured budgets

| | raw | gzip |
|---|---|---|
| geometry + font core (`paper-core`, `paperjs-offset`, `svgpath`, `svgson`, `opentype.js`) | 496 KB | 153 KB |
| Svelte 5 app shell | 43 KB | 17 KB |
