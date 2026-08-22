# 16 — M6: the desktop app

## Verification

| | result |
|---|---|
| `cargo build` | compiles, 51 s cold |
| `tauri dev` | window opens, app runs |
| end-to-end | the running app wrote `~/Library/Application Support/dev.iconotype.app/projects/p0/project.json` — window → Svelte → `AppStore` autosave → `createTauriHost` → `plugin-fs` → capabilities → a real file |
| `pnpm test` | 318 passing |
| `pnpm check` | 417 files, 0 errors |

Not verified: how the native window **looks**. Screen capture on this machine returns
black without a screen-recording permission I cannot grant, so nobody has eyes on the
desktop chrome — the traffic-light overlay, the transparent title bar, the window
minimum size. The frontend itself was checked in a browser at the dev port, which is
the same bundle minus the Tauri IPC.

## What is actually in the Rust

Almost nothing, deliberately:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_opener::init())
    .run(tauri::generate_context!())
```

Every feature lives in the shared TypeScript core. Anything implemented here would
have to be implemented twice more — once for the web, once for the extension — and the
three would drift. The process exists to hand that core a real filesystem, native
dialogs and a window.

## The host adapter

`packages/core-host/src/tauri.ts`, the fourth implementation of the same interface
(memory, web, vscode, desktop). Two things in it are worth naming.

**Path scoping.** Two kinds of path arrive:

- relative — `projects/p0/project.json`, the app's own storage, the same layout the web
  host keeps in OPFS, so `persistence.ts` cannot tell the difference. These resolve
  inside `BaseDirectory.AppData`.
- absolute — from a dialog, and used as given. Opening a project from anywhere on disk
  is the point of a desktop build.

Getting that backwards would either scatter project files across the user's disk or
make a file they opened unwritable, so it is the one part of the adapter with unit
tests (Windows drive letters included).

**Watching.** `plugin-fs`'s `watch` resolves its unwatch function asynchronously, so
`dispose()` has to wait for that promise rather than assuming it has one to call.

## What the desktop gets that the web cannot have

- `Open…` / `Save` / `Save as…` on real files, with ⌘O and ⌘S. A project opened from
  disk keeps its path, so ⌘S writes back to the file the user chose rather than to a
  private store they cannot find.
- A real save dialog instead of a browser download.
- File watching (`capabilities.watch`), so a project edited elsewhere can be noticed.
- Storage that survives a cleared browser cache.

`AppShell` grew three optional props for this — `onOpen`, `onSave`, `onSaveAs` — and
renders the buttons only when a shell passes them. The web and the extension pass
nothing and look exactly as before.

## Capabilities

The window's filesystem permission is scoped to the app's own data directory:

```json
"fs:allow-appdata-read-recursive",
"fs:allow-appdata-write-recursive"
```

Anything outside it has to come from a dialog the user answered — Tauri grants the
picked path implicitly, which is exactly the right granularity: the app cannot read
your home directory, but it can read the file you handed it.

## Two apps, two stylesheets

The extension should look like the editor around it; a standalone app should not. Both
now read the same tokens and load a different palette next to them:

| | extension | app |
|---|---|---|
| palette | `theme-vscode.css` — inherits the user's theme | `theme-modern.css` |
| radius | 3px | 8px / 14px |
| font size | the editor's | 14px |
| panes | hairline dividers, no gap | cards on a ground, `--gs-gap: 10px`, real shadows |
| light mode | whatever the theme says | follows the system |

No component knows which one it got: `theme.css` holds the contract and the element
styles, and neither palette file contains a single rule beyond `:root`. `--gs-divider`
and `--gs-gap` are what let one markup render as a flat editor split or as a set of
cards.

The app layout also stopped being the extension's. Five equal columns fought for width
and squeezed the artwork — the thing you came to look at — between two lists of
controls. Fix, Export and History moved into one scrolling rail: `200px | 1fr | 300px`.

**A sample project.** The hosted app opens empty, and "drop a file here" asks a
first-time visitor for something they may not have. `Host.sampleProjectUrl()` is
optional, the web and desktop shells ship one, and the extension has the workspace's
own fonts and needs none.

## Building it

```bash
pnpm --filter @iconotype/desktop dev      # vite + a live window
pnpm --filter @iconotype/desktop bundle   # .app/.dmg, .deb/.appimage, .msi/.nsis
```

The Rust toolchain is the only extra requirement; the frontend is the same Vite build
the website uses.
