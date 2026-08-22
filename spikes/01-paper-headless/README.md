# Spike 01 — paper.js headless (DOM-free geometry)

**Question:** can `paper.js` + `paperjs-offset` run with no DOM (VSCode extension host, CLI) and in a browser bundle, with correct results and acceptable speed?

**Verdict: YES.** 13/13 probes pass in Node, all pass in a real browser.

```bash
node spike.mjs          # 13 geometry probes, headless node
node width-check.mjs    # offsetStroke width semantics
node miter-check.mjs    # stroke outlining accuracy across all 5 algorithms
npx vite build          # browser bundle (add CORE_ALIAS=1 for the paper-core alias)
```

## Findings

### 1. `paper-full` works headless — jsdom/node-canvas are optional and unused
`require('paper')` in Node loads fine without `canvas` or `jsdom` installed. `paper.setup(new paper.Size(w,h))` works with no canvas element. Confirmed no DOM globals leak: `document`, `window`, `self` all `undefined` after setup.

**Rule: never call `importSVG()` / `exportSVG()`** — those need a DOM. Use `new paper.Path(d)` and `path.pathData` for all I/O. Everything we need (booleans, offsetting, simplify, hit-testing, winding) is available through that door.

### 2. ⚠️ `paperjs-offset` does `import paper from 'paper'` — instance identity matters
Its type guard is `path instanceof paper.Path`. Import `paper/dist/paper-core.js` directly and you get a **second paper instance**, so every call throws:

```
TypeError: Offset source must be a Paper.js Path or CompoundPath
```

Fix: everyone imports `'paper'`. For browsers, alias at bundler level so *both* resolve to the same core build:

```js
// vite.config
resolve: { alias: { paper: 'paper/dist/paper-core.js' } }
```

### 3. `offsetStroke(path, d)` produces a stroke of width **2d**
Verified: a 1000-long line with `d=10` outlines to area 20000. **Always pass `strokeWidth / 2`.** Getting this wrong is a silent 2× error on every outlined icon.

### 4. Stroke outlining is accurate; the "shrink" warning is noise
Ring area vs `perimeter × width`, miter join, limit 4:

| shape | expected | got | error |
|---|---|---|---|
| square 400² | 32000 | 32000 | 0.0% |
| star r 200/80 | 19685 | 19685 | 0.0% |
| star r 200/150 | 14783 | 14783 | −0.0% |
| star r 200/40 (very sharp) | 23985 | 22225 | −7.3% |

The −7.3% is *correct*: at very sharp concave corners the inner offset self-overlaps and the overlap is removed. All five algorithms (`auto`/`adaptive`/`robust`/`split`/`legacy`) return identical results on these shapes — no reason to expose the choice.

`analyze()` reports `positive-offset-area-shrank` even on the 0.0%-error cases → **the warning is not a usable quality signal**; use `selfIntersections` / `containmentErrors` / `distanceErrors` (all 0 here) instead.

### 5. Everything else the fixer needs works
- booleans: unite / subtract / intersect / exclude ✓
- even-odd → nonzero: 6 nested rings, alternate contour direction `cw,ccw,cw,ccw,cw,ccw` ✓
- self-intersection: pentagram `unite` with itself → 5 crossings resolved, 10 segments ✓
- clipPath → intersect ✓
- simplify: 401 → 68 segments (−83%) at tolerance 2.5 ✓
- **determinism: identical `pathData` across repeated identical builds ✓** (font reproducibility depends on this)

### 6. Performance
| | 200 stroke→outline ops | per glyph |
|---|---|---|
| Node 26 | 100 ms | 0.50 ms |
| Browser | 270 ms | 1.35 ms |

A 1000-glyph set outlines in ~1.4 s in the browser. No worker strictly needed; use one anyway to keep the UI responsive.

### 7. Browser bundle size (`paper` + `paperjs-offset` + `svgpath` + `svgson` + `opentype.js`, minified ES)

| build | raw | gzip |
|---|---|---|
| default (`paper-full`) | 643 KB | 202 KB |
| **`paper-core` alias** | **496 KB** | **153 KB** |

The alias drops the PaperScript compiler — 147 KB raw / 49 KB gzip for free. Verified in a real browser: single instance, `offsetStroke` correct, `PaperScript.compile` absent, `opentype.js` wrote a 1268-byte TTF client-side.

`jsdom` / `canvas` are excluded automatically by paper's `browser` field — no polyfills, no build warnings.

## Consequences for the plan
- [04](../docs/04-svg-normalization.md) stage 7 (stroke → outline) is **de-risked**. The contingency (`polygon-clipping` + hand-rolled offsetting) is dropped.
- Core stays DOM-free as designed; `pathData`-only is now a hard architectural rule.
- Add the `paper` alias to every bundler config (web, desktop, vscode webview) — and to `vitest` config, or tests will hit the two-instance trap.
