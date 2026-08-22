# 14 — M4: exports & CLI

## Verification

| | result |
|---|---|
| `pnpm test` | **266 passing** (13 files, up from 220) |
| `pnpm check` | 371 files, 0 errors |
| CLI end-to-end | built a real project from a folder of SVGs, added an icon, and had `diff` catch a moved codepoint with exit 1 |
| browser | every quick-copy format verified against the real project |

Acceptance from [08](08-roadmap.md) was "a repo can regenerate its font in CI with a breaking-change gate". The gate is `glyphsmith diff`, and [`examples/icons-ci.yml`](../examples/icons-ci.yml) is the workflow that uses it.

## The CLI

```
glyphsmith build   build the font package from a project or a folder of SVGs
glyphsmith lint    report what the fixer would have to change; non-zero exit on errors
glyphsmith fix     rewrite source SVGs through the fixer pipeline
glyphsmith diff    compare two projects; non-zero exit when the change is BREAKING
glyphsmith scan    find which icons a codebase actually references
glyphsmith info    summarise a project
```

Input is whatever you point it at: a Glyphsmith or IcoMoon project JSON, an IcoMoon zip, or a directory of SVGs. Argument parsing is `node:util`'s `parseArgs` — no dependency.

### The gate

```
$ glyphsmith diff before.json after/selection.json
added    shape-polygon U+e905
MOVED    shape-circle U+e902 -> U+e950
1 added, 0 removed, 1 moved, 0 redrawn
BREAKING: a removed or moved codepoint changes what existing builds render.
$ echo $?
1
```

Added icons and redrawn artwork are non-breaking. **Removed or moved codepoints are breaking**, because a stylesheet built last week still points at the old codepoint and will now render a different icon — a failure no test in the consuming app would catch. `--allow-breaking` reports it and exits 0 when you actually mean it.

### Codepoint stability

`build` reads `codepoints.lock` before allocating and rewrites it after. Names already in the lock keep their codepoints; only genuinely new ones are appended. Verified: adding a sixth icon to a five-icon folder left the original five untouched and gave the new one `U+e905`.

The lock lives *inside* a folder of SVGs and *beside* a project file. Getting that wrong — as the first implementation did — silently restarts allocation on every build, which is precisely the drift the lock exists to prevent.

## A bug only the end-to-end run found

`glyphsmith diff` reported "0 added, 0 removed" for a project that had visibly gained an icon.

`exportIcoMoonSelection` assigned `id: foreign.icoMoonId ?? 0` — fine for glyphs imported from IcoMoon, but every glyph that came from an SVG file has no such origin, so they **all got id 0**. IcoMoon joins `icons[]` to `selection[]` *by id*, so re-importing collapsed every glyph onto a single selection entry, and the diff of two collapsed projects is empty.

The 243 unit tests passed throughout: they exercise the round trip with the IcoMoon fixture, where every glyph has a real id. Only building from a folder of SVGs, exporting, and reading it back surfaced it.

## Exporters

| output | notes |
|---|---|
| SVG (per icon) | with the `<title>`, fixed-size, tabs and indent switches IcoMoon exposes |
| SVG sprite | `<symbol>` sheet plus the `<use>` and `<symbol>` snippets to reference it |
| PNG sprite | laid out as one SVG and rasterized once, plus the CSS that addresses it |
| PNGs | one per icon, 1x and 2x |
| favicons | 16/32/180/192/512 plus `site.webmanifest` and an SVG favicon |
| React, Vue, Svelte, Web Component, Elm | one component switching on a name |
| `icons.d.ts` | a union of every icon name, so a typo is a compile error |
| quick copy | character, CSS escape, class name, SVG, data URI, `<use>`, `<symbol>` |

**Rasterization stays out of `core-export`.** The host injects a `Rasterizer` — `@resvg/resvg-js` in the CLI, `OffscreenCanvas` in the browser — and every raster output is produced by composing one SVG and rendering it once, rather than stitching bitmaps. The package remains pure text and testable with a five-line stub.

**Elm gets real `Svg.path` nodes.** The other targets inject a markup string; Elm has no way to do that, so it emits actual nodes. The first draft ignored this and produced a module that could not compile.

## Bundling the CLI: three failures, one shape

The binary is bundled with esbuild, and every attempt to bundle its *dependencies* failed differently:

1. **`--packages=external` (ESM)** — `Cannot find package 'paper'`: under pnpm, a transitive dependency is not resolvable from `bin/`.
2. **Bundling everything (ESM)** — `Dynamic require of "path" is not supported`: paper's node emulation layer uses dynamic `require`. The paper-core alias from the web builds does not help, because **paper-core carries the same shim** — it is the `browser` field, not the entry point, that hides it in Vite.
3. **Bundling everything (CJS)** — `Cannot find module '../data/patch.json'`: css-tree loads a data file relative to its own module path, which bundling relocates.

Final shape: bundle our own sources into one CJS file, leave third-party packages external and declared as dependencies. 92 kB, and the failure modes above are structural rather than fixable.

## Gaps carried forward

- `scan` matches icon names textually. A name that is also an English word (`search`, `home`) will over-count; the report is a starting point, not proof.
- `--only` is suggested by `scan` but not implemented yet, so subsetting is manual.
- No `.ico` container — the favicon set ships PNGs and an SVG, which is what modern browsers use.
- Components are emitted as one file switching on a name. Per-icon modules would tree-shake better for very large sets.
- The CLI has no config file; everything is flags. A `glyphsmith.config.json` would help once there are more knobs than fit on a line.
