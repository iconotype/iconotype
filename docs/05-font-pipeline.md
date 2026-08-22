# 05 — Font pipeline

Pure JS, identical in browser / Node / Tauri / VSCode. No server, no native toolchain.

## Writer: `svg2ttf` *(revised in M2 — was `opentype.js`)*

This doc originally chose `opentype.js` as the writer. Building M2 measured three
disqualifying behaviours:

| | `opentype.js` 2.0.0 | consequence |
|---|---|---|
| output flavour | CFF, signature `OTTO` | not a glyf TTF; `.ttf` would be a lie |
| `head.modified` | always `Date.now()` | **never byte-stable**; two builds a second apart differ |
| `Path.fromSVG` | y-flips per glyph using *that glyph's* bounding box | every glyph lands at a different baseline unless `flipY: false` |

`svg2ttf` has none of these: real glyf TTF (`00010000`), an explicit `ts` option for
deterministic output, and it derives ligature GSUB from multi-character `unicode`
attributes for free. It is also the stack IcoMoon itself uses, so output stays familiar.

`opentype.js` remains the right tool for **reading** fonts (importing an existing font as
a set, and verifying our own output in tests).

```
Project
   └─► SVG font (text, an export format in its own right)
         └─► svg2ttf { ts }                  → TTF (glyf)
               ├─► woff2-encoder (wasm)      → WOFF2
               ├─► ttf2woff                  → WOFF
               └─► ttf2eot                   → EOT      (P2, drop candidate)
```

Building through a text format means a wrong glyph can be inspected, diffed and pasted
into a browser — worth more than the microseconds a direct binary writer would save.

## Coordinate conversion

SVG is y-down, origin top-left. Fonts are y-up, origin at baseline.

```
unitsPerEm = emSize            (IcoMoon default 1024; verified project used 512)
baselinePct = preferences.fontPref.metrics.baseline   (IcoMoon: 6.25)
descender  = -round(unitsPerEm * baselinePct / 100)
ascender   =  unitsPerEm + descender
scale      =  unitsPerEm / sourceGridSize             (grid 24 → 1024/24)

glyphPath = svgPath
  .scale(scale, -scale)
  .translate(0, ascender)
```

`whitespace` (IcoMoon: 50%) controls the space glyph advance and side bearings.
Per-glyph `advanceWidth` defaults to `unitsPerEm` (square icons) but must be
overridable for wide glyphs, otherwise wide icons get clipped in text flow.

## Codepoint allocation

- Default range: PUA **U+E900**–U+F8FF (IcoMoon's start; 6400 usable slots).
- Optional secondary planes: U+F0000 and U+100000 for very large sets.
- Allocation is **append-only** and recorded in `codepoints.lock`:

```
altitude    U+E900
walk        U+E901
# multicolor glyph occupies a run
flag        U+E902..U+E904
```

- Never reuse a freed codepoint by default (a stale CSS build would render the wrong icon). `--reclaim` opt-in for the brave.
- `iconotype diff` classifies: `added`, `removed`, `path-changed`, `codepoint-moved`. Any `codepoint-moved` or `removed` = **breaking**, non-zero exit in CI.

## Ligatures

`liga` GSUB so `<span class="icon">home</span>` renders the glyph. Requires:
- one glyph per input character (a–z, 0–9, `-`, `_`) present in the font, else the ligature never triggers;
- IcoMoon's `selection[].tempChar` field is the placeholder mechanism for this — mirror it on import.
Warn when ligature names collide with real words in body text (the classic "type `home` in a paragraph and get an icon" bug).

## Multicolor

Two outputs from one source glyph:

1. **IcoMoon-compatible layers** — split by fill color, one glyph + codepoint per layer (`selection[].codes: number[]`), CSS emits `.icon-x .path1:before { content: "\e902"; color: … }` stacked with negative margins. Color themes come from the set's `colorThemes: [[r,g,b,a], …]`.
2. **COLR/CPAL** — single glyph, layered color table, one codepoint. Modern browsers only, but no CSS gymnastics. `opentype.js` support needs verification; may require hand-writing the two tables (they are simple).

## CSS emitter

Options to honour (all present in IcoMoon `fontPref`): `prefix`, postfix, `embed` (base64 data URI), `showSelector`, class-selector vs attribute-selector mode, `classSelector`, `showMetrics`, `showMetadata`, `showVersion`, `cssVars` + `cssVarsFormat` (`scss` | `less` | plain custom properties), `ie7`.

Output bundle:
```
fonts/name.woff2|woff|ttf
style.css | style.scss | variables.scss
demo.html
selection.json         # IcoMoon-compatible, so users are never locked in
icons.json             # our manifest
ATTRIBUTION.md
```

## Determinism

Sort glyphs by codepoint, fixed `head.created`/`modified` timestamps (from git commit or a config constant, **not** `Date.now()`), stable name-table order, fixed rounding mode. Then `build && build` produces identical bytes and CI caching works.
