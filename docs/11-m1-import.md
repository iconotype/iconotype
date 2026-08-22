# 11 — M1: import & view

## Verification

| | result |
|---|---|
| `pnpm test` | **57 passing** (9 files) |
| `pnpm test:vscode` | 3 passing, real VSCode 1.134.0 |
| `pnpm check` | 337 files, 0 errors |
| round-trip | `alpimaps.json` → model → JSON is **byte-identical** |
| browser run | dropped the real file into the built app: 3 sets, 25 glyphs, correct codepoints, search/selection/undo/reload all working |

## What lossless actually required

A naive field mapper passes every "does it import?" test and still rewrites the user's file. Three things had to be preserved that are invisible until you diff the output:

1. **Key order varies per object.** One set writes `licenseURL,license`; the next writes `license,licenseURL`. `JSON.stringify` follows insertion order, so objects are rebuilt in the source's own key order ([`preserve.ts`](../packages/core-io/src/preserve.ts)).
2. **`icons[]` and `selection[]` are not sorted.** Display order lives in `selection[].order`; array position is arbitrary. Our model stores glyphs in *display* order, and array indices ride along in `foreign` so export can put them back.
3. **`width` is a real field**, not noise — a per-glyph advance width. It maps to `Glyph.advanceWidth`; ignoring it would silently narrow wide glyphs.

Unmapped fields are captured verbatim and replayed, so an IcoMoon feature we do not model yet still survives a round-trip.

## The import pipeline

```
.json  ─┬─ project  (iconSets[])          ─┐
        ├─ selection (IcoMoonType)         ├─→ normalize to shape A ─→ Project
        └─ iconSet  (IcoMoonType)         ─┘
.zip   ─┬─ contains selection.json        ─→ IcoMoon package import
        └─ otherwise                      ─→ treat as an archive of SVGs
.svg   ──────────────────────────────────  ─→ shapes→path, transforms baked,
                                              arcs normalized, strokes outlined,
                                              viewBox fitted, fills split into layers
```

SVG import is the M1 slice of [04](04-svg-normalization.md) — stages 4–7 plus viewBox fitting. Everything it cannot represent produces a named warning (`TEXT_ELEMENT`, `IMAGE_EMBEDDED`, `GRADIENT_UNSUPPORTED`, `CLIP_DROPPED`, `MASK_DROPPED`, `USE_UNRESOLVED`, `STROKE_DASHARRAY`, `STROKE_NONUNIFORM`, `MULTIPLE_COLORS`) rather than silently mangling the glyph.

## Two bugs the unit tests could not catch

**Svelte 5 deep `$state` broke every core op.** `$state` wraps the document in a Proxy; `structuredClone()` — which every op uses to stay immutable — throws `DataCloneError` on a proxy. Node tests passed because they never went through Svelte. Only the browser run surfaced it, as an import that silently did nothing. Fix: `$state.raw`, which is also the honest model (commit returns a whole new session). Now guarded by [`session.test.ts`](../packages/ui/test/session.test.ts), which runs the rune store under vitest.

**`svgson` only parses documents rooted at `<svg>`** — anything else throws "nothing to parse", so the "wrong root element" branch was unreachable and users got a meaningless error. Now pre-checked with a message that names the file and says what was expected.

## Virtualized grid

Sections have two row heights (header vs glyph row), so [`VirtualGrid.svelte`](../packages/ui/src/VirtualGrid.svelte) keeps a prefix-sum offset array and binary-searches the first visible row rather than assuming a uniform height. Verified in the browser: 25 glyphs → 11 cells in the DOM.

## Gaps carried forward

- Export UI is M4; `exportIcoMoonProject` / `exportIcoMoonSelection` exist and are tested, but nothing in the app calls them yet.
- Bundle is now 341 KB raw / 121 KB gzip; ~200 KB of that is paper.js, pulled in only for stroke outlining. A dynamic import of `core-io` would defer it — worth doing in M2.
- Drag-and-drop reordering of glyphs, and multi-select with shift-range, are not implemented (click and ctrl/cmd-click are).
- No project switcher UI; the app reopens the most recent project.
