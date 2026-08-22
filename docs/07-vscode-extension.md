# 07 — VSCode extension

The reason to build this at all. IcoMoon cannot do any of it.

Extension host runs `core-*` directly (Node). The webview runs the same Svelte UI as web/desktop, over a `postMessage` RPC that implements `Host`.

## Discovery

On activation, find the project: `glyphsmith.config.*`, `icons.json`, a folder of `.svg`, an IcoMoon `selection.json`, or a `.woff2` + CSS pair in the workspace. Multi-root aware. Build an in-memory index: `name → { codepoint, svg, set, license, ligatures }`.

## A. Reading code

| # | Feature | How |
|---|---|---|
| A1 | **Inline glyph decoration** — render the real icon next to `icon-home`, `\e900`, `Icons.Home` | `TextEditorDecorationType` with `before.contentIconPath` = data-URI SVG, theme-colored |
| A2 | Gutter icon variant for dense files | `gutterIconPath` |
| A3 | **Hover preview** — large glyph, name, codepoint, set, license, source URL, "used in N files" | `HoverProvider` |
| A4 | Color-decorator style toggle: show icon / show name / both | setting |
| A5 | Works in HTML, CSS/SCSS/LESS, JS/TS/JSX/TSX, Svelte, Vue, Astro, Markdown | one regex-driven scanner, per-language token rules |

## B. Writing code

| # | Feature | How |
|---|---|---|
| B1 | **Completion with previews** — type `icon-` → list with rendered SVG in the docs pane | `CompletionItemProvider`, `documentation` = MarkdownString with data-URI image |
| B2 | **Icon picker** (`Cmd+K I`) — searchable webview grid, insert at cursor in the right syntax for the current language | webview quickpick |
| B3 | Snippet per framework — detect Svelte/React/Vue/HTML, insert `<Icon name="…"/>` vs `<i class="icon-…">` vs `\e900` | |
| B4 | **Add icon from Iconify** — search, import, normalize, assign codepoint, rebuild font, insert reference — one command | |
| B5 | Paste SVG from clipboard → new glyph | |
| B6 | Drag `.svg` from Explorer onto the icon tree → import | |

## C. Correctness

| # | Feature | How |
|---|---|---|
| C1 | **Diagnostics**: unknown icon name, typo with did-you-mean, deprecated icon, duplicate codepoint, icon referenced but missing from font | `DiagnosticCollection` + quick fixes |
| C2 | **Unused icon report** — in the font but referenced nowhere; offer subset build | `glyphsmith scan` |
| C3 | **Rename refactor** — rename a glyph, update every reference workspace-wide, keep the codepoint | `RenameProvider` on the manifest + workspace edit |
| C4 | **Find all references** of a glyph | `ReferenceProvider` |
| C5 | Breaking-change guard — regenerating with moved/removed codepoints warns before writing | `glyphsmith diff` |
| C6 | CodeLens on `icons.json`: "42 icons · 12 unused · 3 lint errors · Rebuild" | |

## D. Editing & build

| # | Feature | How |
|---|---|---|
| D1 | **Custom editor for `.svg`** — glyph fixer with lint list + autofix buttons | `CustomTextEditorProvider` |
| D2 | **Custom editor for font files** (`.ttf/.otf/.woff/.woff2`) — glyph grid browser of any font in the repo | `CustomReadonlyEditorProvider` |
| D3 | **Custom editor for `.glyphsmith` / `icons.json`** — the full app in a tab | `CustomEditorProvider` |
| D4 | **Tree view** — sets → glyphs, with icon thumbnails, context menus | `TreeDataProvider` |
| D5 | **Watch & rebuild** — SVG changes → font rebuilt → dev server hot-reloads | `FileSystemWatcher` |
| D6 | Task provider + problem matcher, so `glyphsmith lint` errors land in the Problems panel | |
| D7 | Status bar: font version, build state, error count | |

## E. Nice extras

- **Contribute the user's font as product icons** — generate a `contributes.icons` block + `iconFontPath` so their own icons become usable as `$(icon-home)` in tree views, status bar and quick picks. Genuinely novel.
- Pre-commit hook installer: block a commit whose SVG sources changed without a font rebuild.
- Workspace-recommended settings snippet for the font path + CSS alias.
- Notebook output renderer for icon previews (low value; only if free).

## Marketplace positioning

Existing extensions do *one* of: preview an SVG, autocomplete Font Awesome class names, or convert SVG to a component. None owns the whole loop **source SVG → font → code reference → validation**. That loop is the pitch.
