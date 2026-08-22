# 09 — Library evaluation

All versions/licenses checked 2026-08-21. All MIT unless noted.

## Font
| Package | Ver | Use | Verdict |
|---|---|---|---|
| `svg2ttf` | 6.1.0 | SVG font → glyf TTF, deterministic via `ts`, ligature GSUB | **adopted — the writer** (see [12](12-m2-font.md)) |
| `opentype.js` | 2.0.0 | font **reading** + test verification | adopted for reads only; rejected as writer (CFF output, `now()` timestamps, per-glyph y-flip) |
| `woff2-encoder` | 2.0.0 | TTF → WOFF2, wasm, browser-safe | **adopt** |
| `ttf2woff` | 3.0.0 | TTF → WOFF | adopt |
| `ttf2eot` | 3.1.0 | TTF → EOT | optional, P2 |
| `fontkit` | 2.0.4 | rich font parsing | adopt for *import* of exotic fonts |
| `svgicons2svgfont` | 16.0.0 | SVG files → SVG font | not needed — we emit the SVG font ourselves from the project model |
| `subset-font` | 2.5.0 (BSD-3) | subsetting via harfbuzz wasm | P2, for usage-based subset |
| `harfbuzzjs` | 1.6.0 | shaping, ligature verification in tests | test-only |

## Geometry / SVG
| Package | Ver | Use | Verdict |
|---|---|---|---|
| `paper.js` | 0.12.18 | boolean ops, hit-test, simplify, self-intersection | **adopted** — headless verified ([spike 01](../spikes/01-paper-headless/)). Alias to `dist/paper-core.js`. |
| `paperjs-offset` | 2.2.1 | stroke → outline | **adopted** — accurate to 0.0% area error; `offsetStroke(p,d)` ⇒ width `2d`; needs the same `paper` instance |
| `svgpath` | 2.6.0 | transform flatten, unarc, unshort, abs | **adopt** |
| `svg-path-commander` | 2.3.1 | path normalize/reverse/transform | alt to `svgpath`, pick one |
| `svgo` | 4.0.2 | final path cleanup | adopt (as a stage, not the whole fix) |
| `svgson` | 5.3.1 | SVG → JSON AST, DOM-free | **adopt** |
| `css-tree` | 3.2.1 | resolve `<style>` blocks | adopt |
| `bezier-js` | 6.1.4 | curve math where paper is overkill | as needed |
| `polygon-clipping` | 0.15.7 | ~~boolean fallback~~ | **dropped** — paper spike passed |

## Editor (M7)
| Package | Ver | Verdict |
|---|---|---|
| `@svgedit/svgcanvas` | 7.4.2 | rejected — owns the DOM and its own history; poor fit for Svelte state + glyph constraints. Good source to read. |
| `fabric` / `konva` | 7.4.0 / 10.3.1 | rejected — canvas scene graphs, weak at path node editing |
| **own SVG renderer + `paper.js` geometry** | — | **chosen**; Svelte renders the SVG, paper does the math |
| `perfect-freehand` | 1.2.3 | optional freehand/brush tool |

## Rendering / test
| Package | Ver | Use |
|---|---|---|
| `@resvg/resvg-js` | 2.6.2 (MPL-2.0) | Node/Tauri rasterization for PNG export + pixel regression |
| `OffscreenCanvas` | — | browser rasterization |
| `pixelmatch` | 7.2.0 (ISC) | visual regression assertions |

## Content
| Package | Ver | Use |
|---|---|---|
| `@iconify/json` | 2.2.518 | 200k+ icons w/ license metadata — load on demand, never bundle |
| `@iconify/tools` | 5.0.12 | icon cleanup helpers, palette parsing — worth reading before writing our own |

## Shell
- **Svelte 5** (5.56.10) + Vite + TypeScript — webview-verified ([spike 02](../spikes/02-svelte-vscode-webview/))
- **Tauri v2** (`plugin-fs`, `plugin-dialog`, `plugin-updater`)
- `@vscode/vsce`, `@vscode/test-electron` — **no** `@vscode/webview-ui-toolkit`: plain `var(--vscode-*, fallback)` covers theming in all three hosts
- `vitest` + `playwright` (web) + `@vscode/test-electron`
