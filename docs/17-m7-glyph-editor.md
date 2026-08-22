# 17 — M7: the glyph editor

## Verification

| | result |
|---|---|
| `pnpm test` | 346 passing (10 transform, 7 editor actions) |
| `pnpm test:vscode` | 52 passing |
| `pnpm check` | 424 files, 0 errors |
| in the running app | double-click opens on that glyph, `[`/`]` step and wrap, arrows nudge, align/rotate/flip land in history with labels, `+`/`-`/`0` zoom, `g`/`m` toggle guides, `Esc` returns to the grid |

## What it is, and what it is not

Not a bézier editor. The artwork arrives already drawn — from IcoMoon, from a designer's
SVG, from an icon set — and what it actually needs is positional: it sits off-centre,
it is stroked instead of filled, it overlaps itself, it is forty units too far left.
Those are one-click operations, and doing them one glyph after another without leaving
the editor is the whole job.

Node-level editing is deliberately not here. It is a different tool with a different
interaction model, and building it first would have meant a worse version of what
IcoMoon already has instead of the part people actually spend their time on.

## The transforms

`packages/core-svg/src/transform.ts`. All affine except one, all operating on the
glyph's paths **as a set** — a glyph is one drawing, so moving "it" moves every subpath
by the same amount rather than each into its own corner.

Two decisions worth stating:

- **Scale and rotate about the artwork's own centre**, not the origin. Scaling about
  the origin walks a glyph towards the corner as it shrinks, which is never what "make
  this slightly smaller" means.
- **`mergeOverlaps` unites subpaths.** Two overlapping shapes are two contours; a
  non-zero fill hides that until something rasterizes even-odd or a hinting pass trips
  over the self-intersection, and the overlap punches a hole. Uniting up front is the
  fix every font tool eventually offers.

`alignOffset` is separate from `alignPaths` so the offset can be computed and asserted
without touching geometry.

## The actions

Every editor action funnels through one private `#transform`, which:

- resolves the glyph and its set (the set's `height` is the coordinate space, so
  aligning to "the em box" means the right box even when sets differ)
- commits **one** history step, labelled with what it was — `Align hiking`, not
  `Change glyph`
- returns early when the result is identical to the input. An empty history entry is
  worse than no entry: undo would appear to do nothing.

`strokeToFill` is the exception that reads `attrs`: it outlines only the contours that
actually carry a stroke, strips `stroke`/`stroke-width` from those, and says so plainly
when there is nothing stroked, rather than silently doing nothing.

## Navigation

Editing a set is a run — fix this one, next, next — so stepping is one key (`[` / `]`,
or `,` / `.`) and it **wraps**. Dead-ending at the last glyph and making you go back to
the grid is the thing that makes people stop halfway.

| key | |
|---|---|
| `←` `→` `↑` `↓` | nudge by 1/64 em; `shift` 1/8 em; `alt` one unit |
| `[` `]` | previous / next glyph |
| `+` `-` `0` | zoom in / out / reset; ⌘-wheel also zooms |
| `g` `m` | grid, metrics |
| `Esc` | back to the grid |

## One editor, three shells

The same component is the centre pane of the web and desktop apps (double-click a cell)
and the whole of the extension's editor panel, where alt-clicking an icon in the
sidebar now opens the editor **on** that icon rather than beside it.

## Carried forward

- Bézier node editing, boolean ops between selected shapes, corner rounding.
- Per-glyph history. IcoMoon keeps one per glyph; ours is one project-wide tree, which
  is right for undo but means "revert this glyph" is a manual walk.
- Pixel preview at a fixed size, to check hinting-free rendering at 16px.
