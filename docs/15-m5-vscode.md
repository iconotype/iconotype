# 15 — M5: the VSCode extension

## Verification

| | result |
|---|---|
| `pnpm test:vscode` | **51 passing**, real VSCode 1.134.0 |
| `pnpm test` | 315 passing (17 files) |
| `pnpm check` | 391 files, 0 errors |

Everything below is exercised through the real extension host: discovery from disk, export writing actual files, the completion and hover providers via `vscode.executeCompletionItemProvider`, and the usage scan over a real workspace.

## The project file

One committed file per icon font: **`<name>.glyphsmith.json`**. It holds the artwork, the codepoints **and** where a build writes its output, so the editor, the CLI and CI need no second config.

```jsonc
{
  "schemaVersion": 1,
  "name": "app",                          // family, class prefix root, autocomplete trigger
  "font": { "family": "app", "prefix": "app-", "emSize": 1024, "baseline": 6.25, "whitespace": 50, "version": "1.0" },
  "height": 1024,
  "output": {
    "fonts": { "dir": "app/fonts", "formats": ["woff2", "woff", "ttf"] },
    "styles": [
      { "kind": "scss-variables", "path": "app/css/_icons.scss" },
      { "kind": "css",            "path": "app/css/icons.css" }
    ],
    "types": { "path": "app/types/icons.d.ts" }
  },
  "icons": [
    { "name": "home", "code": "e900", "paths": ["M100 100H900V900H100Z"], "tags": ["home", "house"] },
    { "name": "legacy", "code": "e902", "selected": false, "paths": ["…"] }
  ]
}
```

Design choices that matter in a pull request:

- **Icons are sorted by codepoint**, so adding one is a one-hunk diff instead of a reshuffle.
- **`selected` is only written when false.** A file full of `"selected": true` is noise.
- **`code` is hex without `U+`** and is the font's API — the schema says so in its description, which surfaces as a tooltip in the editor.
- A **JSON schema** ships with the extension and is registered for `*.glyphsmith.json`, so the file is completed and validated as you type it.

Ships with `$schema`, and refuses to open a file whose `schemaVersion` is newer than the build understands rather than silently misreading it.

## Quick export

`Glyphsmith: Export Font` builds and writes straight to the configured paths — no zip, no unpacking:

```
app/fonts/app.woff2      app/fonts/app.woff      app/fonts/app.ttf
app/css/_icons.scss      app/css/icons.css
```

Two details that make it usable in a webpack-style layout:

1. **The `@font-face` url is computed relative to each stylesheet.** Fonts in `app/fonts` and styles in `app/css` produce `url('../fonts/app.woff2')`, not a project-root path that would 404. Override with `output.fonts.publicPath` for pipelines that rewrite urls (`~assets/fonts/`).
2. **Identical bytes are not rewritten.** A no-op export leaves file mtimes alone, so it never dirties the working tree or triggers a watcher storm.

The SCSS output matches IcoMoon's `variables.scss` shape, so an existing stylesheet keeps compiling:

```scss
$app-font-family: "app" !default;
$app-font-path: "../fonts" !default;

$icon-home: "\e900";
```

with one deliberate difference: IcoMoon hardcodes `$icomoon-font-family` whatever the font is called, so **two IcoMoon exports in one project collide on that variable**. Ours is namespaced by the family. The font path is the same relative path the CSS uses, not a project-root path.

Settings supply defaults for projects that do not configure their own — `glyphsmith.defaults.fontsDir`, `.stylesDir`, `.styleKind`, `.formats` — and they live in `.vscode/settings.json`, so a team shares one layout. `glyphsmith.exportOnSave` rebuilds whenever the project file is saved.

## Export settings

IcoMoon's export panel exposes a set of switches; these are the ones that change the
output, all living in the project file's `font` block (and validated by the schema):

| setting | effect |
|---|---|
| `prefix` / `postfix` | may interpolate `${i}` (glyph index) and `${u}` (codepoint hex) — `-${u}` gives `.icon-home-e900` |
| `classPerGlyph` | `.icon-home:before { content }` — on by default |
| `propertyPerGlyph` | `--icon-home: "\e900"` on `:root`, for referencing a codepoint from your own rules |
| `glyphNames` | human-readable names in the font's `post` table; off makes the font measurably smaller |
| `palettePrefix` + `allColorPalettes` | `.palette1 .path2:before { color: … }` for multicolor artwork |
| `metadata` | copyright, designer, licence and url, written into the font's name table |
| em size · baseline % · whitespace % · version | already supported since [M2](12-m2-font.md) |

Style outputs now include **`dart`**, a Flutter `IconData` class with the pubspec
snippet in its header — IcoMoon's "Dart Class for Flutter".

**Not supported: OTF/CFF2.** The writer emits a glyf TTF (and WOFF/WOFF2 wrapping it)
for the reasons in [12](12-m2-font.md). CFF2 would need a second writer; nothing in a
web or Flutter workflow needs it.

## In the editor

| feature | notes |
|---|---|
| **Autocompletion** | Typing `app-` offers that font's icons, each with a rendered preview, its codepoint and its tags as filter text. Deselected icons are never suggested — they will not be in the built font. |
| **Inline previews** | The glyph itself is drawn next to `app-home` in your source, and next to a raw `\e900` escape in CSS. |
| **Hover** | A large preview, the codepoint, the owning font, ligatures and licence. |
| **Icon grid** | A sidebar webview: filter, click to include/exclude from export, alt-click to open the editor, buttons to import SVGs and export. |
| **Fonts tree** | Every font in the workspace with its icons, each rendered as its own tree icon. Inline actions to export, add icons, toggle and remove. |
| **Usage view** | Every icon with the places it is referenced, **unused first** — the actionable end of the list. Click a site to jump to it. |
| **Insert Icon** | A quick pick that inserts a reference at the cursor. |
| **Status bar** | Total icons selected across every font; click to export them all. |

Multiple fonts are first class throughout: the registry is keyed by file, completion is per prefix, and the grid has a font switcher.

## Four bugs the integration tests caught

1. **The generated stylesheet counted as usage.** `icons.css` names every icon, so after one export every icon looked used and the unused list was always empty. The scan now excludes each font's own configured output paths.
2. **Completion never fired in untitled buffers.** The providers were registered with `scheme: 'file'`. Dropping the filter costs nothing and covers scratch buffers.
3. **Decoration icons resolved to `vscode-userdata:`.** `globalStorageUri` can carry that scheme, and `contentIconPath` is not documented to resolve it. Pinned to a plain `file:` URI at the same location. (Data URIs were the first attempt and are worse: `Uri.parse` returns them percent-encoded as `image/svg%2Bxml`.)
4. **The rewrite dropped the webview's RPC server.** The editor panel's `Host.fs` adapter went unanswered, so every filesystem call from the editor hung. The M0 round-trip test caught it immediately — which is exactly why that test exists.

## Closing the gaps (M5.1)

Four of the five gaps this milestone left open are now done — **27 integration tests**.

### The editor persists what it edits

The panel received its project but nothing sent changes back, so every edit made there
was silently lost. Now each edit travels op → history → effect → `postMessage` → the
extension → the file, and the extension pushes changes made elsewhere (grid, tree, git)
back into any open panel.

Both directions are guarded by a snapshot comparison. Without it, our own save comes
back through the file watcher, replaces the document, and either clobbers the editor's
history or ping-pongs between the two.

### Diagnostics

A reference to an icon that does not exist renders **nothing at all**, silently, and no
test in the consuming app notices. Two warnings now cover it:

- `unknown-icon` — not an icon in this font, with a Levenshtein "did you mean" and a
  one-click quick fix.
- `excluded-icon` — the icon exists but is deselected, so it will not be in the built
  font. A materially different problem, and a materially more useful message.

A bug worth recording: the first version checked `registry.resolve()` and skipped
anything that resolved — but `resolve()` finds an icon whether or not it is selected, so
the excluded case was unreachable. The integration test caught it immediately.

### Rename, go-to-definition, find-references

F2 on `app-home` renames the glyph in the project file, updates every reference in the
workspace, and **keeps the codepoint** — moving it would make every already-shipped
build render the wrong glyph. All of it in one undoable workspace edit; like any
refactor, the touched files are left dirty for you to save.

Go-to-definition jumps from a reference to the icon's entry in the project file, and
find-references lists every use.

### Incremental usage

Saving a file re-indexes just that file. A full scan is too slow to repeat, and a stale
index quietly reports icons as unused after you delete their last reference.

### Importing from the UI (M5.2)

`glyphsmith init --input alpimaps.json --name app --prefix app- --fonts-dir app/fonts
--styles-dir app/css --style-kind scss-variables` is a fine CI command and a hostile
first impression. `Glyphsmith: Import IcoMoon Project…` asks the same six things as a
wizard, defaults them from the workspace settings, and writes the identical file.

The source picker takes an IcoMoon project or `selection.json`, a font-package `.zip`,
an SVG-only `.zip` (tried as a fallback when there is no `selection.json`, because that
is the other thing IcoMoon hands out), or a folder of SVGs. The empty Fonts view and
the empty Icons grid both lead here, and right-clicking a `.json` or `.zip` in the
explorer skips the picker.

The layout logic is *shared*, not reimplemented: `outputConfigFor()` in core-export now
backs the CLI's `init`, the extension's settings fallback and the wizard. Three
implementations of "where does `_app.scss` go" would have drifted, and the whole claim
of the project file is that the editor, the CLI and CI agree.

Reading is `workspace.fs`, never `node:fs` — a remote or virtual workspace has no local
path at all — over the same pure importers the CLI uses.

**Merging** (`+ Project`) adds another font's icons to one that already exists. Names
that collide are skipped rather than overwritten: a collision is nearly always two
different drawings, and replacing artwork that is already referenced in the codebase is
the worse failure. An incoming codepoint is honoured only when it is free.

Two things the tests pinned down, neither of which unit tests would have:

- Importing must not renumber. `prepareImported` is split out of the prompting so a
  test can assert that renaming the font to `brand` leaves `compass` on `U+e950`.
- `registers every contributed command` now reads the manifest instead of a hand-kept
  list. A contributed-but-unregistered command is a silent "command not found" the
  first time a user clicks it, and the old list would not have covered the new ones.

### Opening the editor destroyed the project (M5.3)

Found by a user, in their own repo, on the first day: import worked, then alt-clicking
an icon left an empty font and a blank editor. The evidence was a 297-byte
`alpimaps.glyphsmith.json` — `family: "glyphsmith"`, `prefix: "icon-"`, `icons: []`,
which is exactly `defaultFontPrefs()`.

The editor webview boots holding `emptyProject('p0', 'Loading…')` and its save effect
runs on mount, before the extension's `project` message arrives. So opening the panel
posted a save of the placeholder, and the extension wrote it to the file. Every
integration test passed throughout: they drove the webview through test seams that
happen to run *after* the project has landed.

The fix is a per-panel token: the extension generates one, sends it with the project,
and ignores any save that does not carry it. The webview additionally refuses to save
before it has one. Two guards because the cost of this failing is someone's artwork.

`test('opening the editor never overwrites the project with an empty one')` was checked
against the broken build first — with both guards removed it fails with "the artwork was
wiped by opening the editor". A regression test nobody has seen fail is a guess.

The same report also fixed:

- **Alt-click did not open the icon.** The grid sent `open` without the glyph id, so
  the editor opened on nothing in particular. The id now travels through
  `glyphsmith.open(uri, glyphId)` into the `project` message as `focus`, and the
  sidebar grid outlines and scrolls to it too.
- **A broken project file crashed the usage scan.** The registry's placeholder for an
  unparseable file carried `preferences: {}`, and `resolveOutputConfig` reads
  `preferences.font.family`. It is a real `emptyProject()` now.

### Usage: used icons, not just unused ones (M5.3)

The panel sorted unused-first and then listed everything flat, so the icons you can
actually click through to were below however many unused ones you had. Now it groups:
**Used (n)** expanded, each icon expanded to its call sites; **Unused (n)** collapsed
underneath.

The scan also reports `12/25 referenced, 41 times` rather than a bare unused count —
and when a font has *zero* references it looks for the prefix the code actually uses.
The user's codebase writes `alpimaps-directions_walk`; a font imported as `app-` would
report all 25 unused with no clue why. It now offers the prefix it found, with a button
that patches the project file.

### The editor panel, embedded (M5.4)

Opened from the extension, the panel rendered the whole web app: set list, grid, fix,
export and history, five columns in a shared width, three of them repeating what the
sidebar already shows. `AppShell` now takes an `embedded` prop; the VSCode shell passes
it and gets glyph detail + fix + history instead.

`GlyphDetail` is the new "view/edit": the artwork large, its name inline-editable, its
codepoints, its fill colours as swatches, and the actions — replace the SVG, copy the
class, flatten to one colour, remove.

It also fixed a bug the panel announced on every keystroke:
`save failed: Error: EROFS: read-only file system, mkdir '/projects'`. `AppShell`
autosaves through the Host's project store, which is right for the web and desktop
shells and wrong here — the extension owns the `.glyphsmith.json`. `AppStore.autosave`
turns it off, and the webview sets it.

### Colour, and why a glyph should not have any (M5.4)

A font glyph paints in whatever the CSS says; it has no colour of its own. IcoMoon's
answer for a coloured icon is to split it into one glyph per layer and stack them,
which is why `road-cycling` occupied `U+e916 U+e917 U+e918`. Almost every icon that
ends up that way did so by accident, from an SVG carrying more than one fill.

So the grid marks it: a dot per fill colour at the bottom-left of the cell, and the
codepoint count at the bottom-right when a glyph is multicolor. `Flatten to One Colour`
merges the layers into one shape and releases the extra codepoints — **keeping the
first**, so anything already built still renders.

### The sidebar (M5.4)

- Excluded icons are coloured through a `FileDecorationProvider`. The include/exclude
  toggle is an inline action, so it only appears on hover; the state now shows on the
  row itself without hovering.
- Right-click in the grid: open in editor, show usage, replace SVG, include/exclude,
  copy class name, remove.
- A collapsed **Font settings** panel in the grid for the four values that decide what
  an export produces — prefix, family, fonts dir, stylesheet path. They write to the
  project file, so the CLI and CI see the same change.

### Why the usage scan reported everything as unused (M5.4)

`findFiles(include, exclude, 5000)`. The user's repo has **21,274** files matching the
include glob, and the excludes covered `node_modules` and `dist` but not `platforms/`,
`vendor/`, `.yarn/` or `.bundle/` — which in a NativeScript project hold generated
copies of the whole app. The cap was spent in there and the scan never reached `app/`.
With the excludes fixed the same repo yields **520** files.

The cap is now 40,000 *and* reported: a truncated scan says so and refuses to claim
anything is unused, because a silent cap reads exactly like a clean answer.

All three are settings rather than constants, because no built-in list survives contact
with a real repo layout:

| setting | |
|---|---|
| `glyphsmith.usage.excludeDirs` | the directory list itself, **defaulted** so it shows in the settings UI and can be trimmed as well as extended |
| `glyphsmith.usage.useWorkspaceExcludes` | also honour `search.exclude`/`files.exclude` — a repo that told VSCode to ignore its build output has told us too |
| `glyphsmith.usage.maxFiles` | the cap |
| `glyphsmith.usage.exclude` | a raw glob that overrides the lot, for what a directory list cannot express |

### The prefix in the code is not always the prefix in the CSS (M5.5)

The same user, on the real cause: their IcoMoon project declares `icon-`, but their
webpack config rewrites references, so the source writes `alpimaps-hiking`. Both are
correct — they just describe different sides of the build.

So `font.usagePrefixes` is part of the project file: extra prefixes that source code
may use. Completion, hover, decorations, diagnostics, rename, go-to-definition and the
usage scan all look for **every** prefix the font declares; the first usage prefix is
what tooling inserts and copies, since that is what belongs in the code.

Each usage site records the prefix it was written with, so a rename rewrites
`icon-home` in the stylesheet and `alpimaps-home` in the code, each in its own form,
in one edit.

The zero-references warning now offers the right fix first: **Also look for it** adds
the found prefix to `usagePrefixes`, leaving the class prefix — and therefore the
generated CSS and everything already using it — alone. Renaming the class prefix is
offered second.


## Gaps carried forward

- `contributes.icons`, which would let a user's own font supply `$(app-home)` icons to VSCode's own tree views and status bar, is still just an idea from [07](07-vscode-extension.md).
- The rename provider rescans the workspace to find references; on a very large repo that is a noticeable pause before the edit appears.
- The wizard's own prompting is not covered by a test: `showQuickPick`/`showInputBox` cannot be driven from the extension host. Everything either side of it is — reading a source, applying answers, writing the file.
- Diagnostics only cover open documents, so a typo in a file you never open is not reported until you do. `glyphsmith lint` in CI is the backstop.

### Pending exports (M5.6)

Editing an icon changed nothing on disk until an export ran, and nothing said so: the
woff2 the app loaded and the scss it compiled quietly went on being the old ones.

Answering "do the generated files still match the project?" has three possible
mechanics, and two of them are wrong here:

- **mtimes** cannot work. An export that would write identical bytes deliberately
  writes nothing, so the timestamps never catch up and the font reads as stale forever.
- **rebuilding and comparing bytes** is exact but costs a full font build to answer a
  question asked on every keystroke.
- **hashing the inputs** is the middle: `buildStamp()` fingerprints only what can
  reach the output — artwork, names, codepoints, selection, font preferences, the
  output config. A tag or a note changes nothing, and is asserted not to.

The stamp of the last export lives in workspace state rather than a committed file:
staleness is a local question, and CI always builds from scratch. A missing output file
is stale whatever the stamp says, which is what a fresh clone with gitignored build
output looks like.

It surfaces without moving anything: a warning-coloured status bar item that exports on
click, `export pending` on the font in the tree, and the Icons panel's existing Export
button turning amber with a dot. The first attempt was a banner above the grid, which
pushed every icon down the moment you changed one — so the next tick you meant to click
had moved. The dot is always in the layout and only its paint changes, so flipping
state resizes nothing. A test asserts nothing new appears between the toolbar and the
grid. And
`glyphsmith.autoExport` (`off` / `onSave` / `onChange`) removes the step entirely.
`onChange` is debounced and only builds fonts that are actually stale.

### What a click means (M5.6)

Clicking an icon in the grid used to toggle whether it shipped — a destructive-ish
thing to put on the most casual gesture available — while opening it, the thing you
want far more often, was hidden behind alt-click. Now a click opens, and a tick in the
cell's corner includes or excludes. The excluded styling (greyed, struck through) is
unchanged; it just is not what a stray click produces any more.

The cell became a `div` with `role="button"` in the process: a `<button>` cannot
legally contain the tick's own button, and the tick has to be clickable on its own.
Alt- and ctrl-click still toggle, for anyone who learned the old gesture.

### Generated stylesheets are a link, not a use (M5.6)

The usage scan already skipped the paths its own output config names. It did not skip a
stylesheet generated *before* the project became a Glyphsmith one — an IcoMoon
`style.css`, a stale `icons.scss` — and those name every icon in the font, so the whole
thing read as used.

Recognising them by content (`generated by …`, `Do not edit`, or an `@font-face` with a
webfont `url()`) covers those. They are now offered as a **Generated** group in the
usage view: one click opens the file, and nothing in it counts as a reference.

### "Failed to fetch dynamically imported module" (M5.6)

Reported from `Check all glyphs`, which dynamically imports core-svg — paper.js is
200 kB and is not in the initial bundle.

Two fixes, because the report did not pin down which was to blame:

- `'strict-dynamic'` in the webview CSP. A nonce covers scripts the *document* loads;
  a chunk fetched by an already-trusted module carries none, and the refusal surfaces
  as a fetch failure rather than as a policy error.
- **No content hashes on webview chunks.** An extension is installed by replacing a
  directory, not served with cache headers, so hashes buy nothing — and reinstalling
  under a window that already has the panel open leaves it asking for a chunk whose
  hash just changed. Stable names also keep the vsix diff small.
