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

## Decisions

- **UI**: Svelte 5 (runes) + Vite. One component tree, three shells.
- **Font engine**: pure JS — `svg2ttf` writes the TTF, `ttf2woff` and `woff2-encoder`
  wrap it. `opentype.js` was tried first and disqualified: it emits CFF/OTTO, stamps
  `head.modified` with the current time (which quietly broke a determinism test), and
  y-flips `Path.fromSVG` per glyph. See [09](docs/09-libraries.md).
- **Codepoints are an API**: append-only allocation from the PUA, written to
  `codepoints.lock`. A rename moves a name, never a number.
- **Deterministic**: the same project produces the same bytes. No `Date.now()` in core.
- **Core packages are DOM-free** — no `DOMParser`, no `document`. XML via `svgson`,
  geometry via headless `paper.js`.

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
  web/           Vite SPA → GitHub Pages, OPFS storage, File System Access where offered
  desktop/       Tauri v2: real files, native dialogs, drag-drop from the file manager
  vscode/        icon-font manager: grid, completion, previews, usage, quick export
  site/          the product page — plain HTML, no framework
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
pnpm test           # 347 tests, incl. 75-fixture visual regression
pnpm test:vscode    # 52 integration tests in real VSCode
pnpm check          # svelte-check + tsc
pnpm build          # every app
```

CI runs the tests, the VSCode suite under xvfb and a `cargo check` of the desktop crate
on every push. `main` deploys the site and the web app to Pages; a `v*` tag cuts a
release — four desktop bundles, the `.vsix`, and the CLI to npm. See
[19](docs/19-website-and-releases.md).

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
16. [M6 desktop app](docs/16-m6-desktop.md)
17. [M7 glyph editor](docs/17-m7-glyph-editor.md)
18. [The UX pass](docs/18-ux-pass.md)
19. [Website & releases](docs/19-website-and-releases.md)
