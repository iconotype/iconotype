# 04 — SVG normalization & fixing

The core differentiator. Icon fonts accept a **very** narrow subset of SVG:
closed contours, filled, nonzero winding, no strokes, no gradients, no transforms,
one color, y-axis flipped, scaled to em units.

Everything else must be *converted*, not rejected.

## Pipeline stages

Each stage is a pure function `(Doc, Ctx) => { doc, findings[] }`. Findings drive the lint UI.

| # | Stage | What it does | Tool |
|---|---|---|---|
| 1 | **Sanitize** | strip `<script>`, `on*`, external `href`, foreignObject, comments, editor cruft (`inkscape:*`, `sodipodi:*`, `figma:*`) | own |
| 2 | **CSS inline** | parse `<style>`, resolve cascade + specificity, write presentation attributes | `css-tree` |
| 3 | **Deref** | inline `<use>`/`<symbol>`, expand `<defs>` references, drop unused defs | own |
| 4 | **Shapes → path** | rect (incl. rx/ry), circle, ellipse, line, polyline, polygon | own |
| 5 | **Flatten transforms** | multiply matrix stack incl. `viewBox` + `preserveAspectRatio`, bake into path data | `svgpath` |
| 6 | **Normalize commands** | abs, unshort, unarc (arc→cubic), remove no-ops | `svgpath` |
| 7 | **Stroke → outline** | offset both sides by `stroke-width/2`, honour linecap / linejoin / miterlimit / dasharray, union with fill | `paperjs-offset` on `paper.js` |
| 8 | **Clip & mask** | `clipPath` → boolean intersect. Luminance `mask` → white keeps / black subtracts; anything else = warning + best-effort | `paper.js` |
| 9 | **Winding** | `fill-rule: evenodd` → nonzero equivalent; reverse hole contours so nonzero produces holes | `paper.js` boolean |
| 10 | **Color analysis** | collect distinct fills → monochrome, multicolor (N layers), or unsupported (gradient/pattern/image/filter) | own |
| 11 | **Geometry hygiene** | union self-intersections, drop zero-area/degenerate subpaths, auto-close open paths, merge coincident points, optional simplify (tolerance slider), decimal precision, optional grid snap | `paper.js` + own |
| 12 | **Fit** | bbox → target grid; center or align to baseline/cap-height; padding; optional preserve original advance width | own |
| 13 | **Validate** | contour count, point count, coords inside em box, no NaN/Infinity, all contours closed, winding sane, path string length | own |

Order matters: 7 must run after 5 (stroke width is affected by scale) and before 9.

## Lint findings

```ts
interface Finding {
  code: 'STROKE_PRESENT' | 'EVENODD_FILL' | 'MULTIPLE_COLORS' | 'GRADIENT_FILL'
      | 'OPEN_CONTOUR' | 'SELF_INTERSECT' | 'OUT_OF_BOX' | 'TINY_DETAIL'
      | 'HIGH_POINT_COUNT' | 'CLIP_APPROXIMATED' | 'MASK_APPROXIMATED'
      | 'IMAGE_EMBEDDED' | 'FILTER_DROPPED' | 'TEXT_ELEMENT' | 'NON_INTEGER_GRID'
  severity: 'error' | 'warning' | 'info'
  message: string
  autofix?: () => Op[]     // one-click, previewable
  affected?: NodeRef[]     // highlightable in the glyph preview
}
```

UI: glyph card gets a badge; detail panel lists findings with **before/after overlay preview** (original SVG rendered in red 40% under the fixed result). Batch fix = apply to selection, show a grid of before/after thumbs, accept/reject per glyph.

`TEXT_ELEMENT` is an error, not a fix: converting `<text>` needs the actual font file. Offer "convert text to path" only in desktop where we can load system fonts via `fontkit`.

## Hard cases worth naming

- **Stroke joins.** Naive offsetting produces bulges at sharp corners. Must implement miter with `miterlimit` fallback to bevel. Test fixture: a 6-point star with `stroke-linejoin: miter; stroke-width: 4`.
- **Dashed strokes.** Split path by dash array *before* offsetting, then cap each dash. Rare but IcoMoon just drops it.
- **Even-odd with nested holes 3+ deep.** `paper.js` handles it; verify with a bullseye fixture of 6 rings.
- **Sub-pixel details at 16px grid.** After fitting, a 0.3-unit feature vanishes on render. `TINY_DETAIL` warning with the computed rendered size.
- **Non-square viewBox.** Fonts have a fixed em square; decide per-set: fit-inside (letterbox) vs stretch vs preserve advance width. Default fit-inside, expose per-set.
- **Multicolor.** IcoMoon's model: one glyph per color layer, sequential codepoints, CSS `.path1:before { color: … }` stacking. Reproduce exactly (see `selection[].codes` + `colorThemes` in [06](06-import-export.md)), and additionally offer COLR/CPAL as the modern path.

## Testing

- `fixtures/` holds ~60 pathological SVGs (each hard case above, plus real exports from Illustrator, Figma, Inkscape, Sketch, Affinity).
- **Visual regression**: rasterize source SVG and generated glyph at 256px via `@resvg/resvg-js`, compare with `pixelmatch`, assert < 1.5% differing pixels. This catches winding bugs that unit tests never will.
- **Determinism**: build twice, assert byte-identical TTF.
