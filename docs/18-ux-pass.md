# 18 — The UX pass

Everything here came from using the desktop app for an afternoon. Most of it is one
theme: **the app was letting you change things you did not mean to change.**

## Selecting an icon was also deciding whether it ships

The grid had one gesture. Clicking selected an icon *and* replaced whatever was
selected before, and the selection was what the export acted on — so double-clicking an
icon to look at it silently cut the font down to one glyph. Building an export set
meant ⌘-clicking forty icons and never mis-clicking.

They are two different questions and now they are two different controls:

| | |
|---|---|
| click / ⌘-click / ⇧-click | **selection** — the subject of the next bulk action |
| the tick in the corner | **inclusion** — whether the icon is in the built font |
| double-click | edit it, changing neither |

Excluded icons stay visible, dimmed and struck through, and the toolbar reads
`25 shown · 24 in font`. `Include` / `Exclude` act on the selection, or on everything
the search matches when nothing is selected — which is how a 900-icon set becomes the
twelve you need.

## Undo emptied the project

Reported as "undo when there is nothing to undo deletes the glyph", and that is exactly
what it looked like. Opening a document went through `session.replace`, which is a
normal undoable step, so the parent of the first edit was *the state before the file was
open* — an empty project. The first ⌘Z past your own edits threw the document away.

`SessionStore.open()` starts a new timeline instead. A document's history begins when
the document does. Undo and redo are also disabled when there is nothing to do, and
their tooltips name the step: `Undo Exclude 1 glyph(s)`, or `Nothing to undo`.

Verified in the running app: twelve ⌘Z past the end leaves all 25 glyphs, the button
disabled, the timeline rooted at `Import alpimaps.json`.

## Two modes, and only what belongs to each

The right rail mixed a glyph's findings with the project's export settings, and the
editor kept the browse toolbar — search, import, select-all, remove — none of which
mean anything while you are nudging one glyph two units left.

| | browse | edit |
|---|---|---|
| toolbar | import, search, size, selection, include/exclude | — |
| left | sets | — |
| centre | the grid | the glyph |
| right | export | fix + findings |
| both | header: open/save/recent, undo/redo, theme, panels, `?` | |

`Fix` follows the same rule: in the editor its button is `Fix this icon`, and
`applyFix` targets the edited glyph rather than the whole project. Running 900 glyphs
through the fixer from inside a single-glyph view is not a thing anyone meant to do.

Both rails collapse (⌘1, ⌘2), and the grid template only allocates the columns that
are open, so a closed pane leaves no gap behind.

## The editor's controls

- **Symbols became words.** `⇤ ⇔ ⇥` is a guess; `Left Centre Right` is not. Same for
  `Bigger`, `Smaller`, `Rotate ↺`, `Flip H`, `Fit to box`, `Stroke → fill`,
  `Merge overlaps`, `Snap to grid`.
- **Previous/next are fixed to the canvas edges**, 40×76, instead of sitting either
  side of the glyph's name — where they moved every time you used them, which is
  unusable for the one control you press twenty times in a row.
- The header carries an explicit `✓ In font` / `Excluded` toggle, so the answer is
  visible while editing rather than only back in the grid.

## Theme

`system`, `light`, `dark`, cycled from the header. The light palette was already
written for `prefers-color-scheme`; it is now also applied from `data-theme` on the
root, and `data-theme` wins — a person who picked light meant it at midnight too.

Theme, both panel states and the icon size are remembered per host (`ui.json`, beside
the recents). Nothing about chrome belongs in the project file: a collaborator opening
the same `.iconotype.json` should not inherit your theme.

## Keyboard

`?` shows the list, per mode, because a list of twenty shortcuts half of which do not
apply is a list nobody reads.

Browse: `/` search · `E`/`Enter` edit · `space` include/exclude the selection · `⌘A`
select all · `⌘O` import.
Edit: `[` `]` step · arrows nudge · `+` `−` `0` zoom · `G`/`M` guides · `Esc` back.
Anywhere: `⌘Z` / `⇧⌘Z` · `⌘1` / `⌘2` panels · `?`.
