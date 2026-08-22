# 02 — Architecture

## Monorepo

```
pnpm workspace + turbo

packages/
  core-model/     project document, ops + undo/redo + history branches, codepoint allocator
  core-svg/       parse → normalize → fix → lint pipeline (DOM-free)
  core-font/      TTF writer, WOFF/WOFF2/EOT, SVG-font, subsetting, metrics
  core-io/        importers + exporters (icomoon, fontello, zip, font files, iconify, figma)
  core-render/    svg → png / sprite / favicon (adapter: canvas | resvg)
  core-host/      host adapter interfaces (fs, dialog, clipboard, watch, http)
  ui/             Svelte 5 components + stores; zero host assumptions
  cli/            node CLI: build, lint, fix, diff, subset, scan
apps/
  web/            Vite SPA → GitHub Pages
  desktop/        Tauri v2
  vscode/         extension host + webview
fixtures/         pathological SVGs + golden fonts for regression tests
```

## Host adapter (the only per-target code)

```ts
interface Host {
  fs: {
    read(p: string): Promise<Uint8Array>
    write(p: string, d: Uint8Array): Promise<void>
    list(p: string): Promise<Entry[]>
    watch?(p: string, cb: (e: FsEvent) => void): Disposable
  }
  pickFiles(opts): Promise<Handle[]>
  pickDirectory?(): Promise<Handle>
  saveAs(name: string, d: Uint8Array): Promise<void>
  clipboard: { readText(): Promise<string>; writeText(s: string): Promise<void> }
  capabilities: { watch: boolean; realFs: boolean; shell: boolean }
}
```

| Target | fs | watch | notes |
|---|---|---|---|
| web | OPFS + File System Access API | ✗ (poll on focus) | Safari lacks FSA write → fall back to download |
| desktop | `@tauri-apps/plugin-fs` | ✓ native | also owns auto-update, native menus, deep links |
| vscode | `workspace.fs` | ✓ `FileSystemWatcher` | webview talks to host over `postMessage` RPC |

UI never imports a host module directly — it receives `Host` from context. This is what makes one Svelte app run in three places.

## Why core must be DOM-free

`core-svg` runs in the VSCode extension host (Node, no DOM) and in the CLI. So:

- XML: `svgson` / `fast-xml-parser`, not `DOMParser`.
- CSS in `<style>`: `css-tree`, resolved manually into presentation attributes.
- Geometry: `paper.js` in headless mode (`paper.setup(new paper.Size(...))`, no canvas) — verify tree-shaking cost; if `paper` drags in node-canvas, isolate it behind a lazy dynamic import used only by fix stages that need booleans.
- Rasterization is the one exception, hence `core-render` is adapter-based: `OffscreenCanvas` in browser/webview, `@resvg/resvg-js` in Node/Tauri.

## State model (`core-model`)

Document is a plain serializable tree; all mutations go through **operations**:

```ts
type Op =
  | { t: 'glyph.add', set: SetId, glyph: Glyph }
  | { t: 'glyph.patch', id: GlyphId, patch: Partial<Glyph> }
  | { t: 'glyph.reorder', … }
  | { t: 'set.patch', … }
  | { t: 'prefs.patch', … }
```

- Each op has `label` + `invert()` → gives IcoMoon's named history list ("Add 55 glyphs", "Fit viewBox to content") for free.
- History is a **tree, not a stack** → the new app's "Branches" panel. Node = `{ op, parent, children[], timestamp }`. Undo = move pointer to parent; redoing after divergence creates a branch instead of destroying the future.
- Two history scopes, as in the new IcoMoon: **project history** and **per-glyph history**. Same structure, different root.
- Persistence: op log truncated at `preferences.historySize`, plus snapshots every N ops.

## Storage / project format

Two representations, lossless between them:

**A. Folder project (desktop, VSCode, CLI, git)**
```
icons/
  sets/material/walk.svg
  sets/custom/altitude.svg
icons.json          # manifest: sets, metadata, per-glyph name/tags/license/source
codepoints.lock     # name → codepoint, append-only, hand-editable
iconotype.config.ts# build config (formats, prefix, metrics, outputs)
```

**B. Single-file `.iconotype` (web, sharing)** — a zip of the above. Also the download artifact from the web app.

Rationale: a designer edits `walk.svg` in Illustrator, git shows a real diff, CI rebuilds the font. IcoMoon's blob makes all of that impossible.
