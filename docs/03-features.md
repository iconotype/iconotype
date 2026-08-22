# 03 — Feature catalogue

Legend: **P0** = required for first useful release · **P1** = parity completion · **P2** = differentiator / later.

---

## 1. Projects

| # | Feature | Pri | Notes |
|---|---|---|---|
| 1.1 | Multiple projects, list view, duplicate, rename, delete | P0 | new IcoMoon "Projects" screen |
| 1.2 | Import IcoMoon project `.json` | P0 | see [06](06-import-export.md); real-world file verified |
| 1.3 | Import IcoMoon `selection.json` / downloaded zip | P0 | |
| 1.4 | Export project (`.glyphsmith` zip / folder) | P0 | |
| 1.5 | Open folder project (watch mode) | P1 | desktop + VSCode only |
| 1.6 | Named history list, undo/redo | P0 | ops model, [02](02-architecture.md) |
| 1.7 | History **branches** | P2 | new IcoMoon has this; falls out of the tree model |
| 1.8 | Per-glyph history | P1 | |
| 1.9 | Autosave + crash recovery | P1 | OPFS / disk journal |
| 1.10 | Project-level preferences (grid size, history size, show codes) | P0 | maps to IcoMoon `preferences` |

## 2. Sets

| # | Feature | Pri |
|---|---|---|
| 2.1 | Multiple sets per project, each with own `height`, `prevSize`, import grid | P0 |
| 2.2 | Set metadata: name, url, designer, designerURL, license, licenseURL | P0 |
| 2.3 | Enable/disable set (IcoMoon `invisible`) | P0 |
| 2.4 | Reorder sets, reorder glyphs (drag) | P0 |
| 2.5 | Move/copy glyph between sets | P1 |
| 2.6 | Set-level color themes (`colorThemes`, `colorThemeIdx`) | P1 |
| 2.7 | Merge sets / split set | P2 |
| 2.8 | Dedupe by path hash across sets | P2 |

## 3. Glyph library / browsing

| # | Feature | Pri |
|---|---|---|
| 3.1 | Virtualized grid, zoom slider (IcoMoon's `32` size control) | P0 |
| 3.2 | Search by name + tags + set, fuzzy | P0 |
| 3.3 | Selection: click, shift-range, ctrl-multi, select all/none/invert | P0 |
| 3.4 | Show codepoints / names / grid overlay toggles | P0 |
| 3.5 | Tag editing, multi-name (ligature aliases) | P0 |
| 3.6 | Collections / favorites / flags (IcoMoon flag + unflag toolbar buttons) | P1 |
| 3.7 | Per-glyph license + source URL, attribution report | P2 |
| 3.8 | **Iconify browser** — search 200k+ icons from 150+ sets, import with license metadata | P2 |
| 3.9 | Compare/diff two glyphs overlaid | P2 |

## 4. Glyph operations (no canvas needed)

| # | Feature | Pri |
|---|---|---|
| 4.1 | Import SVG files / folder / drag-drop / paste | P0 |
| 4.2 | Replace glyph SVG (keeps name + codepoint) | P0 |
| 4.3 | Download single glyph as SVG | P0 |
| 4.4 | Duplicate glyph | P0 |
| 4.5 | Delete glyph | P0 |
| 4.6 | Transform: rotate 90/180/270, flip H/V, move, scale, fit-to-canvas, crop | P0 |
| 4.7 | Batch transform over selection | P1 |
| 4.8 | Recolor / flatten to single color | P1 |
| 4.9 | Optical centering (center by visual mass, not bbox) | P2 |
| 4.10| Normalization presets ("Material 24", "Lucide 24 stroke 2", "FA 512") | P2 |

## 5. SVG fixing — see [04](04-svg-normalization.md)

| # | Feature | Pri |
|---|---|---|
| 5.1 | Full normalize pipeline (shapes→path, transforms flattened, arcs→cubic) | P0 |
| 5.2 | Stroke → outline | P0 |
| 5.3 | even-odd → nonzero winding conversion | P0 |
| 5.4 | clipPath / mask resolution | P1 |
| 5.5 | `<use>` / `<symbol>` / `<defs>` dereferencing | P0 |
| 5.6 | Lint report per glyph, severity + one-click autofix | P0 |
| 5.7 | Batch fix over selection with preview diff | P1 |
| 5.8 | Multicolor detection → layer split or COLR | P1 |
| 5.9 | Gradient / filter / image detection → clear error, not silent garbage | P0 |
| 5.10| Path simplification with visual tolerance slider | P1 |
| 5.11| Precision reduction + coordinate snapping | P1 |

## 6. Codepoints, names, ligatures

| # | Feature | Pri |
|---|---|---|
| 6.1 | Auto-assign PUA codepoints from 0xE900 | P0 |
| 6.2 | Manual codepoint edit, collision detection | P0 |
| 6.3 | **Codepoint lockfile** — stable across rebuilds, additions append | P0 |
| 6.4 | Ligature support (`liga` GSUB), multi-name | P1 |
| 6.5 | Multicolor glyph = N sequential codepoints (`selection[].codes`) | P1 |
| 6.6 | Name validation (CSS-safe, ligature-safe, reserved words) | P0 |
| 6.7 | Bulk rename with pattern / prefix strip | P1 |
| 6.8 | Reassign-all with breaking-change warning | P1 |

## 7. Font generation — see [05](05-font-pipeline.md)

| # | Feature | Pri |
|---|---|---|
| 7.1 | TTF / WOFF / WOFF2 / EOT / SVG-font | P0 |
| 7.2 | Metrics: em size, baseline %, whitespace %, ascender/descender | P0 |
| 7.3 | Font metadata: family, version major/minor, copyright, designer | P0 |
| 7.4 | CSS: class selector or attribute selector, prefix/postfix, CSS vars (scss/less/plain) | P0 |
| 7.5 | Base64 embed option | P0 |
| 7.6 | demo.html preview page | P1 |
| 7.7 | IE7 support output | P2 (probably drop) |
| 7.8 | COLR/CPAL color font | P2 |
| 7.9 | Deterministic output + build hash | P0 |
| 7.10| Font subsetting from usage scan | P2 |

## 8. Export formats

Parity with new IcoMoon export panel + additions.

| Format | Pri | Note |
|---|---|---|
| Font bundle zip (fonts + css + demo + manifest) | P0 | |
| Raw SVG (per glyph / bulk) | P0 | |
| SVG sprite (`<symbol>` defs) | P0 | |
| SVG `<use>` snippet, `<symbol>` snippet | P1 | |
| Data URI, character, name (quick copy) | P0 | matches Quick Export panel |
| React / Vue / **Svelte** / Elm / Web Component | P1 | Svelte is ours to add |
| PNG sprite + retina, individual PNGs | P1 | `core-render` |
| Favicon set (+ manifest.json) | P1 | |
| CSH (Photoshop custom shapes) | P2 | reverse-engineered binary; low value, do last |
| Library Set (`IcoMoonType: "iconSet"`) | P1 | so users can feed IcoMoon back |
| TypeScript `.d.ts` name union + enum | P2 | |
| Tailwind plugin / CSS custom properties | P2 | |
| `ATTRIBUTION.md` license roll-up | P2 | |

Format options to honour: add `<title>`, prepend names to IDs, fixed size, all color palettes, remove newlines, tabs vs spaces, indent size.

## 9. Glyph editor (M5, canvas)

Modeled on new IcoMoon's editor, but glyph-constrained.

| # | Feature | Pri |
|---|---|---|
| 9.1 | Layers panel: per-shape lock / hide / reorder / rename | P2 |
| 9.2 | Select + transform handles, marquee | P2 |
| 9.3 | Node/pen tool: add/remove/convert points, handles | P2 |
| 9.4 | Arrange: align 6-way, distribute, z-order (back/front/backward/forward) | P2 |
| 9.5 | Combine: union / subtract / intersect / exclude / divide | P2 |
| 9.6 | Snapping: grid, grid midpoints, shapes, guides; snap toggle | P2 |
| 9.7 | Grid: size, auto, show, custom color | P2 |
| 9.8 | viewBox panel: x/y/w/h, link ratio, "Fit to Content", "Rescale content with viewBox" | P2 |
| 9.9 | Live SVG code editor pane, two-way | P2 |
| 9.10| Eyedropper, mirror, boolean preview, measure | P2 |
| 9.11| Copy/paste/duplicate shapes across glyphs | P2 |

## 10. Cross-cutting

| # | Feature | Pri |
|---|---|---|
| 10.1 | Keyboard shortcuts everywhere, command palette | P1 |
| 10.2 | Dark/light theme, respects host theme in VSCode | P0 |
| 10.3 | i18n scaffold | P2 |
| 10.4 | Accessibility: full keyboard nav of the grid, ARIA | P1 |
| 10.5 | Offline-first PWA (web) | P1 |
| 10.6 | Telemetry: none | — |

## 11. CLI

```bash
glyphsmith build            # icons/ + config → dist fonts, deterministic
glyphsmith lint             # SVG problems, exit code for CI
glyphsmith fix --write      # apply normalization to source SVGs
glyphsmith diff old new     # added/removed/changed/moved codepoints; breaking?
glyphsmith scan ./src       # find used icon names → unused report / subset
glyphsmith import icomoon.json
```

## 12. VSCode — see [07](07-vscode-extension.md)
