# 13 — M3: the fixer

## Verification

| | result |
|---|---|
| `pnpm test` | **220 passing** (11 files, up from 84) |
| fixture corpus | **75 SVGs**, every one produces valid glyph geometry |
| visual regression | 60 pixel comparisons: **0.005 % mean, 0.098 % max** (threshold 1.5 %), **52 of 60 pixel-exact** |
| `pnpm check` | 359 files, 0 errors |
| browser | dropped 8 pathological fixtures into the built app: all became correct glyphs, findings attached, badges shown, before/after overlay working |

Acceptance from [08](08-roadmap.md) was "all fixtures produce valid glyphs, < 1.5 % pixel diff". Actual worst case is 0.098 %, on `mask-black-cuts`.

## The pipeline

All thirteen stages from [04](04-svg-normalization.md) are implemented, split across four modules so each is testable on its own:

| module | stages |
|---|---|
| [`prepare.ts`](../packages/core-svg/src/prepare.ts) | 1 sanitize · 2 CSS inlining · 3 `<use>`/`<symbol>` dereferencing |
| [`traverse.ts`](../packages/core-svg/src/traverse.ts) | 4 shapes → path · 5 transform baking · 6 command normalization · 7 stroke outlining · 8 clip/mask collection |
| [`geometry.ts`](../packages/core-svg/src/geometry.ts) | 8 clip/mask booleans · 9 winding · 11 hygiene · 12 fit |
| [`pipeline.ts`](../packages/core-svg/src/pipeline.ts) | 10 colour grouping · 13 validation, and the composition of the rest |

Every mutation and every impossibility produces a typed `Finding` with a stable code, deduplicated and counted. There are 31 codes across three severities; nothing is silently dropped.

## Measured decisions

**Even-odd → non-zero is `reorient(false)`.** Probed five candidates against a six-ring bullseye with a known analytic area. `reorient(true)` and `resolveCrossings()` both collapse the rings into one filled disc (area 282 823 against an expected 164 934). `reorient(false)` reads the contours with even-odd semantics and produces `cw,ccw,cw,ccw,cw,ccw` at area 164 980. Guessing here would have produced solid blobs where holes belong.

**`resolveCrossings()` is missing from paper's `.d.ts`** but present at runtime and in its published API docs. Declared narrowly as a local interface rather than casting to `any`.

## Bugs the corpus caught

1. **An absent `fill` means black, not `none`.** The M1 predicate treated `undefined` as "no fill", so every unstyled `<rect>` produced an empty glyph. Two fixtures failed immediately; a synthetic test with explicit fills never would have.
2. **`TRANSFORM_BAKED` only fired for an element's own `transform`,** never for one inherited from an ancestor group — so the most common real-world case went unreported.
3. **Degenerate primitives vanished silently.** A `width="0"` rect never reaches paper, so hygiene could not report it. Now caught where it is seen.
4. **A `<line>` produced an empty layer.** It has no area, so its fill layer came out blank — which would have emitted a blank glyph layer and burned a codepoint.
5. **`<filter>` was never reported.** The element lives in `<defs>` (skipped wholesale) and is referenced by *attribute*, which is the only place it can be caught.

## A bug in the harness, not the pipeline

Two mask fixtures showed 26 % and 86 % pixel differences. The geometry was correct — the *test* was wrong. It normalized colours with `source.replace(/fill="..."/g, 'fill="black"')` so a multicoloured source could be compared to a monochrome glyph, and that regex also rewrote `fill="#fff"` **inside the `<mask>` elements**, destroying the masks before rendering.

The harness now renders both sides to a binary coverage mask (painted → opaque, else transparent) and compares those. Colour is irrelevant, which is the honest comparison: coverage is the only thing a font glyph promises to preserve.

Worth remembering: when a visual test fails, the harness is as likely to be wrong as the code.

## The corpus

[`fixtures/svg/`](../fixtures/svg/) holds 75 committed SVGs plus [`generate.mjs`](../fixtures/svg/generate.mjs), which authors them, and `manifest.json`, which records for each one the findings it must produce and whether it is pixel-comparable.

Fixtures whose input contains something a font cannot hold (text, images, gradients) are excluded from the pixel comparison **by the manifest**, not by loosening the threshold — a visual difference there is the correct outcome, and it is stated per fixture with a note.

Groups: transforms (6), primitives (8), path data (6), strokes (10), winding (4), clip and mask (6), references (5), styling (6), unsupported content (6), document structure (6), geometry quality (5), colour (4), real-world exporter noise (3).

## In the app

- **Badges** on glyph cells: red for errors, amber for warnings.
- **Fix panel**: findings for the focused glyph, a before/after overlay (original in red beneath the fixed result), simplify and snap sliders, refit toggle.
- **Check all glyphs** lints the whole project and reports errors/warnings/clean.
- **Fix selected/all** applies the pipeline as a single labelled history step, so it is undoable like anything else.
- Findings recorded at import stay attached to the glyph, rather than scrolling past as a notice. Re-linting merges anything the current settings would additionally do.

## Gaps carried forward

- **Dashed strokes** are outlined as solid. Splitting a path by its dash array before offsetting is the remaining piece of stage 7.
- **Masks are luminance-approximated** (light keeps, dark cuts). True alpha masking cannot be represented in a monochrome glyph at all, so this is a judgement call rather than a bug — but a gradient mask will be wrong, and is reported as approximated.
- **`objectBoundingBox` units** on clips are treated as `userSpaceOnUse` and reported.
- **`<text>` conversion** still needs the source font; the desktop build could do it with `fontkit` against system fonts.
- The pipeline runs on the main thread. A 1000-glyph batch fix would block the UI; the worker is spiked (`worker-src blob:` is in the CSP) but not wired.
