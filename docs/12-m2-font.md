# 12 — M2: font build

## Verification

| | result |
|---|---|
| `pnpm test` | **84 passing** (10 files) |
| `pnpm test:vscode` | 3 passing, real VSCode 1.134.0 |
| `pnpm check` | 347 files, 0 errors |
| visual | all 24 monochrome alpimaps glyphs rendered **from the generated WOFF2** and pixel-compared to their source SVGs at 96 px: **0.01 % mean / 0.054 % max** difference (1 px tolerance), no blank glyphs |
| reproducibility | font and full zip byte-identical across builds a second apart |

The visual check is the one that matters. It runs the real path — project → SVG font → TTF → WOFF2 → `FontFace` → `fillText` on a canvas — and compares against the same paths rasterized as SVG. Without the 1 px tolerance the mean is 2.09 %, all of it uniform edge dilation from font rasterization (stem darkening), not shape error.

## The writer changed: `opentype.js` → `svg2ttf`

[docs/05](05-font-pipeline.md) picked `opentype.js`. Three measurements overturned it:

1. **It emits CFF, not glyf.** Signature is `OTTO`. Shipping that as `.ttf` is misleading and loses compatibility we get for free elsewhere.
2. **`head.modified` is always `Date.now()`.** Output is never byte-stable. The M0 determinism test passed only because both builds landed inside the same second — a latent flake that was also a false green.
3. **`Path.fromSVG` y-flips per glyph using that glyph's own bounding box.** `M10 10` came back as `y = 50`. Combined with our own flip it would have double-transformed every glyph onto a different baseline. `{ flipY: false }` disables it, but the default is a trap.

`svg2ttf` has none of these, takes an explicit `ts`, and derives ligature GSUB from multi-character `unicode` attributes. It is also IcoMoon's own stack. `opentype.js` is kept for *reading* fonts and for verifying our output in tests.

Building through an SVG font (a text format) also means a wrong glyph can be inspected and pasted straight into a browser.

## `paths[]` is not one entry per colour

The single most valuable thing the real fixture taught. A monochrome glyph routinely has several `paths` entries — they are **subpaths of one shape sharing one codepoint**. `mountaineering` has six; `compass-calibrate` has five. Only `isMulticolor` promotes each entry to its own glyph and codepoint.

The first implementation treated every entry as a colour layer, so eight of the 25 icons silently lost most of their artwork and produced spurious "not enough codepoints" warnings. Unit tests with synthetic single-path glyphs would never have caught it.

## What is emitted

```
fonts/<family>.woff2        primary
fonts/<family>.woff         fallback
fonts/<family>.ttf          glyf TTF, 00010000
fonts/<family>.svg          SVG font (also the build's intermediate form)
style.css                   @font-face + base selector + per-icon rules + CSS custom properties
variables.scss | .less      $icon-home: "\e900";
demo.html                   searchable preview page
codepoints.lock             append-only name → codepoint record
ATTRIBUTION.md              per-set licence roll-up
selection.json              IcoMoon-compatible, so users are never locked in
```

Supported along the way: `emSize` distinct from the set's path space (alpimaps is em 512 with 1024-unit paths), per-glyph advance widths (three Font Awesome glyphs are wider than an em), the `whitespacePct` space glyph, multicolor stacked `.path1/.path2` rules with per-layer colours, ligatures with the blank component glyphs they need in order to fire, hidden sets excluded, and named warnings for missing codepoints, duplicate codepoints and short codepoint runs.

## Determinism needed two fixes, not one

`svg2ttf`'s `ts: 0` makes the font stable — but the *package* still was not, because **fflate stamps every zip entry with `Date.now()`**. `writeZip` now defaults to the zip epoch (1980-01-01). Both are now asserted by tests that sleep 1.1 s between builds, so a regression cannot hide inside the same second again.

## Bundle: 631 kB → 32 kB gzip on first paint

Statically importing `core-io` and `core-font` put paper.js and the WOFF2 wasm in the entry chunk. They are now behind dynamic imports in `AppStore`:

| chunk | gzip | loaded |
|---|---|---|
| app shell | ~32 kB | at boot |
| `core-io` (paper.js, svgson, fflate) | 96 kB | first import |
| `core-font` (WOFF2 wasm) | 505 kB | first export |

The wasm stays inlined as base64 rather than fetched: in a VSCode webview a separate `.wasm` fetch would need `asWebviewUri` plumbing (constraint 4), and the chunk is only paid on export.

## Gaps carried forward

- No EOT. It needs a Node-oriented encoder and only matters for IE ≤ 8.
- Ligature component glyphs are blank and zero-width; typing `home` in body text set in this font renders nothing until the ligature fires. Same as every icon font that does this, but the demo page should say so.
- No COLR/CPAL colour font yet (M8); multicolor uses IcoMoon's stacked-pseudo-element model.
- The export panel exposes family, prefix, em size and formats. The rest of `FontPrefs` (baseline %, whitespace %, version, selector mode, embed) is honoured by the builder but not yet surfaced in the UI.
