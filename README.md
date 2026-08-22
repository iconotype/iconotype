# Iconotype

Open-source IcoMoon alternative: create, manage, fix and export icon fonts.

**[iconotype.github.io/iconotype](https://iconotype.github.io/iconotype/)** ·
[web app](https://iconotype.github.io/iconotype/app/) ·
[releases](https://github.com/iconotype/iconotype/releases) ·
[extension](https://marketplace.visualstudio.com/items?itemName=iconotype.iconotype-vscode)

Ships as **three targets from one codebase**:

| Target | Host | Notes |
|---|---|---|
| Web | GitHub Pages, static | no backend, OPFS + File System Access API |
| Desktop | Tauri v2 | real filesystem, folder watch, CLI bridge |
| VSCode | extension + webview | the differentiator: font-aware editing |

## Decisions locked

- **UI**: Svelte 5 (runes) + Vite
- **Font engine**: pure JS (`opentype.js` writer + `woff2-encoder` / `ttf2woff` / `ttf2eot`), runs identically in browser, Node, Tauri, VSCode
- **Editing**: viewer/fixer first, visual glyph editor in phase M5
- **Core packages are DOM-free** — no `DOMParser`, no `document`. XML via `svgson`, geometry via `paper.js` headless.

## Spikes — both blocking risks resolved

| Spike | Verdict |
|---|---|
| [01 paper.js headless](spikes/01-paper-headless/) | DOM-free geometry works; 0.5 ms/glyph outlining; deterministic; 153 KB gzip core |
| [02 Svelte 5 in a VSCode webview](spikes/02-svelte-vscode-webview/) | Works in real VSCode 1.134.0 under strict `style-src`; needs `'wasm-unsafe-eval'` + `worker-src blob:` |

## Layout

```
packages/
  build-config/  shared bundler constraints (paper alias, CSP, no-inline assertion)
  core-model/    project document, ops + inverse, history TREE, codepoint allocator
  core-host/     Host adapter interface + memory and web (OPFS) implementations
  core-svg/      the 13-stage fixer pipeline: sanitize, CSS, deref, shapes, transforms,
                 strokes, clip/mask, winding, hygiene, fit, validate
  core-font/     metrics, SVG font → TTF/WOFF/WOFF2, CSS + demo + zip bundle
  core-io/       IcoMoon import/export (lossless), SVG import, zip
  core-export/   sprite, components, types, favicons, quick-copy formats
  cli/           iconotype build | lint | fix | diff | scan | info
  ui/            Svelte 5 components, stores, OPFS persistence
apps/
  web/           Vite SPA → GitHub Pages
  vscode/        icon-font manager: grid, completion, previews, usage, quick export
spikes/          the two de-risking experiments
examples/        icons-ci.yml — regenerate a font in CI with a breaking-change gate
fixtures/
  icomoon/       a real IcoMoon project, used as the round-trip fixture
  svg/           75 pathological SVGs + manifest, the fixer's corpus
```

```bash
pnpm install
pnpm dev            # web app
pnpm dev:site       # product page
pnpm dev:desktop    # tauri window (needs the Rust toolchain)
pnpm test           # 346 tests, incl. 75-fixture visual regression
pnpm test:vscode    # 52 integration tests in real VSCode
pnpm check          # svelte-check + tsc
pnpm build          # web + vscode
```

Not yet a git repo — `git init && git add -A` then push to trigger the Pages and CI workflows in `.github/workflows/`.

## Docs

1. [Vision & scope](docs/01-vision-and-scope.md)
2. [Architecture](docs/02-architecture.md)
3. [Feature catalogue](docs/03-features.md)
4. [SVG normalization & fixing](docs/04-svg-normalization.md)
5. [Font pipeline](docs/05-font-pipeline.md)
6. [Import / export formats](docs/06-import-export.md)
7. [VSCode extension](docs/07-vscode-extension.md)
8. [Roadmap](docs/08-roadmap.md)
9. [Library evaluation](docs/09-libraries.md)
10. [M0 scaffold](docs/10-m0-scaffold.md)
11. [M1 import & view](docs/11-m1-import.md)
12. [M2 font build](docs/12-m2-font.md)
13. [M3 the fixer](docs/13-m3-fixer.md)
14. [M4 exports & CLI](docs/14-m4-exports-cli.md)
15. [M5 VSCode extension](docs/15-m5-vscode.md)
