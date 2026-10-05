# 22 — The `.iconotype.json` project file (spec)

This is the reference for the committed project file. Read it before generating or
editing one by hand or from a script. The JSON schema
([`apps/vscode/schema/iconfont.schema.json`](../apps/vscode/schema/iconfont.schema.json),
published at `https://iconotype.github.io/iconotype/schema/iconfont-1.json`) checks the
shape. This document covers the rules a schema cannot express. The reader and writer
live in [`packages/core-io/src/iconfont-file.ts`](../packages/core-io/src/iconfont-file.ts):
if this page and that code ever disagree, the code is right and this page is the bug.

## 1. What the file is

- One file per icon font, named **`<name>.iconotype.json`**. The `.iconotype.json`
  suffix is how the VSCode extension finds it (`**/*.iconotype.json`, or the paths listed
  in the `iconotype.files` setting) and how the editor attaches the schema.
- It holds the artwork (SVG path data), the codepoints, the font settings **and** where
  a build writes its output. The editor, `iconotype build` and CI all read this one file;
  there is no second config.
- It is meant to be committed. Writers keep it deterministic so that changing one icon
  gives a one-hunk diff.
- UTF-8 JSON. Writers emit 2-space indentation and a trailing newline. Comments are
  **not** allowed (it is `.json`, not `.jsonc`).

## 2. Minimal valid file

```json
{
  "schemaVersion": 1,
  "name": "app",
  "icons": []
}
```

Only `schemaVersion`, `name` and `icons` are required. Everything else has a default
(§4). A file with no `output` block builds, but each tool picks its own destination
(§6.4), so a generated file should almost always include `output`.

## 3. Complete example

```json
{
  "$schema": "https://iconotype.github.io/iconotype/schema/iconfont-1.json",
  "schemaVersion": 1,
  "name": "app",
  "font": {
    "family": "app",
    "prefix": "app-",
    "usagePrefixes": ["brand-"],
    "postfix": "",
    "emSize": 1024,
    "baseline": 6.25,
    "whitespace": 50,
    "version": "1.0",
    "classPerGlyph": true,
    "propertyPerGlyph": false,
    "glyphNames": true,
    "palettePrefix": "palette",
    "allColorPalettes": false,
    "metadata": {
      "copyright": "© 2026 Example Inc.",
      "designer": "Example design team",
      "designerURL": "https://example.com",
      "license": "MIT",
      "licenseURL": "https://opensource.org/licenses/MIT",
      "description": "Icons for the Example app",
      "url": "https://example.com/icons"
    }
  },
  "height": 1024,
  "output": {
    "fonts": { "dir": "app/fonts", "formats": ["woff2", "woff", "ttf"] },
    "styles": [
      { "kind": "css", "path": "app/css/app-icons.css" },
      { "kind": "scss-variables", "path": ["app/css/_icons.scss", "admin/css/_icons.scss"] }
    ],
    "types": { "path": "app/types/icons.d.ts" },
    "sprite": { "path": "app/public/icons.svg" },
    "demo": { "path": "docs/icons.html" }
  },
  "icons": [
    {
      "name": "home",
      "code": "e900",
      "tags": ["home", "house"],
      "ligatures": ["home"],
      "paths": ["M512 128L128 448V896H384V640H640V896H896V448Z"]
    },
    {
      "name": "arrow-wide",
      "code": "e901",
      "width": 1536,
      "grid": 24,
      "paths": ["M0 448H1280L1024 192H1280L1536 512L1280 832H1024L1280 576H0Z"]
    },
    {
      "name": "warning",
      "code": "e902",
      "codes": ["e903"],
      "paths": ["M512 64L960 896H64Z", "M480 352H544V640H480ZM480 704H544V768H480Z"],
      "colors": ["rgb(255,193,7)", "rgb(0,0,0)"]
    },
    {
      "name": "legacy",
      "code": "e904",
      "selected": false,
      "paths": ["M128 128H896V896H128Z"],
      "source": { "url": "https://example.com/legacy.svg", "license": "MIT", "author": "Jane Doe", "importedFrom": "legacy.svg" }
    }
  ],
  "credits": [
    { "name": "Lucide", "license": "ISC", "licenseURL": "https://lucide.dev/license", "designer": "Lucide Contributors", "url": "https://lucide.dev" }
  ]
}
```

This example lists every option, including some set to their default value
(`postfix`, `classPerGlyph`, `propertyPerGlyph`, `glyphNames`, `palettePrefix`,
`allColorPalettes`). That is valid. Iconotype's writer would leave those keys out (§7).

## 4. Field reference

"Written when" says when Iconotype's own writer emits the key. A reader accepts every
key whether or not the writer would have emitted it. Keys not listed here are
**ignored when read and dropped on the next save** (§7).

### 4.1 Top level

| key | type | required | default | meaning |
|---|---|---|---|---|
| `$schema` | string | no | — | Schema URL. Writers always emit `https://iconotype.github.io/iconotype/schema/iconfont-1.json`. |
| `schemaVersion` | integer | **yes** | — | Must be `1`. A reader refuses a file with a higher number rather than misreading it. |
| `name` | string | **yes** | — | Project name. Writers set it equal to `font.family`; keep them the same. |
| `font` | object | no | see §4.2 | Font and stylesheet settings. |
| `height` | number | no | `1024` | Size of the coordinate space that **every** icon's `paths` are expressed in (§5.1). It is not the output em size (`font.emSize`). |
| `output` | object | no | none | Where a build writes its files (§6). |
| `icons` | array | **yes** | — | The icons (§4.3). May be empty. |
| `credits` | array | no | none | Licence and attribution for the artwork (§4.4). |

### 4.2 `font`

| key | type | default | written when | meaning |
|---|---|---|---|---|
| `family` | string | top-level `name` | always | CSS `font-family`, and the base name of every font file (`<family>.woff2` …). Use a filename-safe value. |
| `prefix` | string | `"icon-"` | always | Class prefix: an icon `home` gets `.app-home`. Autocompletion triggers on it. May contain `${i}` (glyph index in the font) and `${u}` (codepoint in hex). |
| `usagePrefixes` | string[] | none | non-empty | Prefixes your *source code* writes when a build step rewrites them to the class prefix (e.g. a webpack alias mapping `brand-home` to `icon-home`). Completion, usage scan, rename and diagnostics look for these too; the first is what tooling inserts. Omit it when code uses `prefix` directly. |
| `postfix` | string | `""` | non-empty | Class suffix. Same `${i}` / `${u}` interpolation: `"-${u}"` gives `.icon-home-e900`. |
| `emSize` | integer | `1024` | always | Units per em in the built font. Paths are scaled from `height` to this. |
| `baseline` | number | `6.25` | always | Descender, as a percentage of the em. |
| `whitespace` | number | `50` | always | Advance of the space glyph, as a percentage of the em. |
| `version` | string | `"1.0"` | always | `"<major>.<minor>"`, both integers. Written into the font. |
| `classPerGlyph` | boolean | `true` | `false` | Emit `.app-home:before { content: "\e900" }` per icon. |
| `propertyPerGlyph` | boolean | `false` | `true` | Emit `--app-home: "\e900"` on `:root`. **Currently no visible effect:** a project read from this file always gets the `:root` block, because the internal IcoMoon-era `cssVars` preference defaults to on and is not stored in the file. |
| `glyphNames` | boolean | `true` | `false` | Write readable glyph names into the font's `post` table. `false` makes the font slightly smaller. |
| `palettePrefix` | string | `"palette"` | not `"palette"` | Class prefix for multicolor palettes (`.palette1`, `.palette2`). |
| `allColorPalettes` | boolean | `false` | `true` | Emit rules for every colour palette, not only the active one. |
| `metadata` | object | none | non-empty | Strings written into the font's `name` table: `copyright`, `designer`, `designerURL`, `license`, `licenseURL`, `description`, `url`. All optional. |

### 4.3 `icons[]`

| key | type | required | default | written when | meaning |
|---|---|---|---|---|---|
| `name` | string | **yes** | — | always | Unique within the file. Becomes the class name (`prefix + name + postfix`), the TypeScript union member and the glyph name. Use `[a-z0-9_-]` only (the SVG importer reduces filenames to this). |
| `code` | string | **yes** | — | always | Codepoint in lowercase hex, without `U+` or `0x` (`"e900"`). The reader tolerates a `U+` / `0x` prefix, but the schema does not. See §5.2. |
| `codes` | string[] | no | none | multicolor | Extra codepoints, one per additional colour layer. Layer 0 uses `code`, layer *n* uses `codes[n-1]`. |
| `selected` | boolean | no | `true` | `false` | `false` keeps the artwork and its codepoint but leaves the icon out of the built font and out of autocompletion. |
| `tags` | string[] | no | `[name]` | not just `[name]` | Search keywords. |
| `ligatures` | string[] | no | none | non-empty | Text that renders as this icon when typed in the font (`"home"`). |
| `grid` | integer | no | `0` | non-zero | Grid the artwork was drawn on (e.g. `24`). Used by the editor for snapping; `0` means none. Does not affect the build. |
| `width` | number | no | `height` (square) | set | Advance width in the same units as `height`. Omit for a square icon. |
| `paths` | string[] | **yes** | — | always | SVG path data (§5.1). At least one entry. |
| `colors` | string[] | no | none | multicolor | CSS colour per layer, parallel to `paths` (`"rgb(68,68,68)"`, `"#ffc107"`; `""` for none). **Two or more entries make the icon multicolor** (§5.3). |
| `source` | object | no | none | non-empty | Where the artwork came from: `url`, `license`, `author`, `importedFrom` (all optional strings). Informational. |

### 4.4 `credits[]`

| key | type | required | meaning |
|---|---|---|---|
| `name` | string | **yes** | Collection or source name, e.g. `"Lucide"`. |
| `license` | string | no | e.g. `"ISC"`, `"CC BY 4.0"`. |
| `licenseURL` | string | no | |
| `designer` | string | no | |
| `url` | string | no | |

Every credit is printed in a comment at the top of generated stylesheets. Keep one entry
per licence source. For CC BY artwork this is how attribution is kept, so do not drop
entries.

## 5. Rules the schema cannot express

### 5.1 Artwork: coordinate space and geometry

- Paths are in **SVG coordinates**: origin top-left, y pointing **down**, inside the
  box `0..width` × `0..height`, where `height` is the top-level `height` and `width` is
  the icon's `width` (default `height`). The build scales by `emSize / height`, flips y
  and sits the box on the font's ascender. Artwork drawn on a 24×24 viewBox therefore
  has to be scaled to 1024 (×42.667) when `height` is 1024.
- **One `height` for the whole file.** All icons share it. There is no per-icon viewBox.
- Paths are used **as is**: the build does not normalize them. Each path must already be
  font-ready:
  - filled, closed contours. Strokes are not rendered, so convert strokes to outlines first;
  - nonzero winding, with holes wound opposite to their outer contour. An `evenodd` path
    pasted unchanged will fill its holes;
  - no transforms, no `<use>`, no units, no NaN, no arcs outside the box.
- Any SVG path command is allowed (`M L H V C S Q T A Z`, absolute or relative).
- In a monochrome icon (no `colors`, or a single colour) several `paths` entries are
  simply subpaths of one shape and share the single codepoint.

The safe way to produce font-ready paths is to let Iconotype convert SVG files (§8): its
fixer ([04](04-svg-normalization.md)) outlines strokes, fixes winding, flattens
transforms and scales to `height`.

### 5.2 Codepoints

- **Codepoints are the font's public API.** Code and CSS already reference `\e900`.
  Never change the `code` of an existing icon, never reuse a removed icon's code for a
  different icon, and never renumber. `iconotype diff` fails CI when this happens.
- Use the Private Use Area: **`e900`–`f8ff`**. New icons go after the highest code in
  use: `max(all code and codes) + 1`, starting at `e900` for an empty file. This is the
  same rule as Iconotype's allocator (`packages/core-model/src/codepoints.ts`).
- Codes must be unique across every icon and every layer. A duplicate is reported by the
  build as `DUPLICATE_CODEPOINT`.
- `code` is required. A placeholder such as `"0"` is taken literally (U+0000) and is
  **not** reallocated. If you cannot pick codes, let Iconotype assign them (§8).
- **`codepoints.lock`.** `iconotype build` reads, then rewrites, a `codepoints.lock` next to
  the project file (override with `--lock`). One line per icon: `name<TAB>U+e900`, a
  run as `U+e902..U+e903`, a gapped list as `U+e902,U+e905`, `#` for comments.
  When both name the same icon, **the project file wins**. The lock only supplies codes
  for icons that have none. Commit it alongside the project file.

### 5.3 Multicolor icons

An icon is multicolor when `colors` has **two or more** entries. Then:

- `paths[i]` is colour layer *i*, painted with `colors[i]`;
- each layer is its own glyph and needs its own codepoint: `1 + codes.length` must equal
  `paths.length`. Layers without a codepoint are dropped from the build
  (`MISSING_LAYER_CODES`);
- give the layers a contiguous run (`e902`, `e903`, …) when you can. The allocator does
  this, and the lock writes it as a range.

### 5.4 Names

- Unique. Two icons with the same name share one codepoint entry, and one of them is lost.
- Renaming an icon is a breaking change for every class reference in the code, but its
  codepoint should stay the same.
- `name` is also the default single tag, so leave `tags` out unless you add keywords.

## 6. `output`: where a build writes

```json
"output": {
  "fonts":  { "dir": "app/fonts", "formats": ["woff2", "woff", "ttf"], "publicPath": "/static/fonts/" },
  "styles": [ { "kind": "scss-variables", "path": "app/css/_icons.scss" } ],
  "types":  { "path": "app/types/icons.d.ts" },
  "sprite": { "path": "app/public/icons.svg" },
  "demo":   { "path": "docs/icons.html" }
}
```

Every `dir` / `path` takes **a string or a non-empty array of strings**. An array writes
the same bytes to each destination. Prefer a plain string when there is one destination.

| key | required inside | meaning |
|---|---|---|
| `fonts.dir` | `fonts` | Directory for the font files. Each format is written as `<dir>/<font.family>.<format>`. |
| `fonts.formats` | `fonts` | Any of `woff2`, `woff`, `ttf`, `svg`. OTF/CFF is not supported. |
| `fonts.publicPath` | — | What `@font-face src: url()` points at. Omitted, it is computed **relative to the first path of each stylesheet** (`app/css` → `app/fonts` gives `../fonts/`). Set it when a bundler rewrites URLs (`~assets/fonts/`) or when one stylesheet is written to several depths. |
| `styles[].kind` | each entry | See below. |
| `styles[].path` | each entry | File to write. |
| `types.path` | `types` | A `.d.ts` exporting a union of every selected icon name. |
| `sprite.path` | `sprite` | An SVG `<symbol>` sprite of every selected icon. |
| `demo.path` | `demo` | A standalone HTML preview page. |

`styles[].kind`:

| kind | output |
|---|---|
| `css` | `@font-face`, a `.icon` base rule, a `:root` block of custom properties, and one `:before` rule per icon (§6.5) |
| `scss` / `less` | the same, as SCSS / Less |
| `scss-variables` | `$app-font-family`, `$app-font-path`, then `$app-home: "\e900";` (IcoMoon `variables.scss` shape) |
| `less-variables` | `@app-home: "\e900";` |
| `css-variables` | `:root { --app-home: "\e900" }` |
| `json` | `{ "home": "e900" }` |
| `dart` | a Flutter `IconData` class |

### 6.1 What gets written

- No `fonts` block: **no font files are written**, even when there are styles.
- Only selected icons (`selected` not `false`) are built.
- Output is deterministic: the same file gives the same bytes. The editor skips writing
  files whose bytes have not changed.

### 6.2 What paths are relative to

All output paths are relative and use `/`. **The base directory differs between tools:**

- `iconotype build --input path/to/app.iconotype.json` resolves them against the
  **directory containing the project file**.
- The VSCode extension resolves them against the **workspace folder** containing the
  project file (or the file's directory when it is outside any workspace folder).

These agree only when the project file is at the root of its workspace folder. **Put
the project file at the repository root**, or `iconotype build` and the editor will write
to different places.

### 6.3 Generated files are not usage

The extension's usage scan ignores every configured output path, so writing the
stylesheet inside `src/` does not make every icon look used.

### 6.4 When `output` is absent

- `iconotype build` without `--out` writes a packaged layout to `dist/`.
- The extension uses the `iconotype.defaults.*` workspace settings, falling back to
  `fonts/` plus `css/<family>.css`.
- The web app downloads a zip.

Generated files should include `output` so every tool writes to the same place.

### 6.5 Using the generated CSS

The `css` / `scss` / `less` stylesheet sets `font-family` on a fixed **`.icon`** base
class, and each icon class only sets `content`. Markup therefore needs both classes:

```html
<i class="icon app-home"></i>
```

A multicolor icon also needs one child per layer: `<i class="icon app-warning"><span
class="path1"></span><span class="path2"></span></i>`. When the font has ligatures, the
build reports `LIGATURE_BLANKS`. This is expected: blank glyphs are added for the
ligature letters.

## 7. How readers and writers treat the file

When the editor, the desktop app or `iconotype add` saves the file, the writer:

1. Re-emits `$schema` and `schemaVersion: 1`.
2. Sets `name` to `font.family`.
3. Sorts `icons` by codepoint (then by name).
4. Omits every key whose value is the default (the "written when" column in §4).
5. Drops unknown keys, at every level.
6. Keeps every `credits` entry, and appends a credit for any icon set added in the app
   whose licence/designer pair is not already listed.

So a hand-written or generated file is valid even when it is not in canonical form, but
the first save will reformat it. To produce a file that round-trips with **no diff**,
follow those six rules yourself. Running `iconotype add` or `init` re-emits it
canonically.

Reading is lenient: missing optional keys take their defaults, and `code` may carry a
`U+` / `0x` prefix (the writer strips it). Reading is strict about `schemaVersion` (must be a number, ≤ 1) and
`icons` (must be an array). Anything else fails with
`not a Iconotype icon font file`.

## 8. Generating a project file: recommended recipes

Ordered from safest to most manual.

**A. From a folder of SVGs (best for new artwork).** Write ordinary SVGs (any viewBox,
strokes allowed), then:

```bash
npx @iconotype/cli init --input icons/ --name app --prefix app- \
  --fonts-dir app/fonts --styles-dir app/css --style-kind css --out app.iconotype.json
```

The fixer normalizes each SVG, names icons after their filenames (lowercased, `[a-z0-9_-]`)
and allocates codepoints from `e900`. `init` does **not** read `codepoints.lock` and
overwrites `--out`, so do not re-run it over an existing project: the codes would be
reallocated in filename order. Add SVGs to an existing project with the editor's import
(VSCode, desktop or web app), which keeps existing codes and appends new ones.

**B. From open icon libraries.** Start from the minimal file in §2 (plus `font` and
`output`), then:

```bash
npx @iconotype/cli find "house" --limit 5
npx @iconotype/cli add lucide:house mdi:cog --input app.iconotype.json
```

`add` fetches the paths, normalizes them, allocates codepoints after the highest one in
use, records `source` and adds `credits`. It scales new icons to **1024**, whatever the
file's `height`, so keep `height: 1024` in a file you feed to `add`.

**C. From an existing IcoMoon / Fontello-era project.** Use `iconotype init --input
selection.json`. Existing codepoints are kept.

**D. Writing the JSON directly.** Only when you control the geometry. Checklist:

- [ ] `schemaVersion: 1`, `name` equal to `font.family`, `$schema` set
- [ ] every `paths` entry is font-ready and expressed in `0..height` (§5.1)
- [ ] every icon has a unique `name` and a unique `code` in `e900`–`f8ff`. New codes are
      `max + 1`, and existing codes are untouched (§5.2)
- [ ] multicolor icons have `1 + codes.length === paths.length === colors.length` (§5.3)
- [ ] `output` present, paths relative to the project file's directory, file at repo root (§6.2)
- [ ] validate: `npx @iconotype/cli info --input app.iconotype.json`, then
      `npx @iconotype/cli build --input app.iconotype.json` and check for `warning:` lines

## 9. Versioning

`schemaVersion` and the schema URL move together. `iconfont-1.json` is frozen once
shipped: additive, backwards-compatible changes (a new optional key, widening a type as
`string` → `string | string[]` did for output paths) stay in version 1. Anything an
older reader would misread gets `schemaVersion: 2` and `iconfont-2.json`, and the
`ICONFONT_SCHEMA_VERSION` constant in `iconfont-file.ts` is bumped with it.

When changing the format, update in one commit: `IconFontFile` and the
reader and writer in `iconfont-file.ts`, the model types in `core-model/src/types.ts`, the
schema, and this page. `packages/core-io/test/iconfont-file.test.ts` checks that the
schema `$id`, the constant and emitted files agree.
