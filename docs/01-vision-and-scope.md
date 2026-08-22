# 01 — Vision & scope

## Problem with IcoMoon today

- Closed source, single web app, project state is an opaque JSON blob that git cannot diff meaningfully.
- No CI story. Regenerating a font is a manual browser session; codepoints drift silently and break every consumer.
- No editor integration. `icon-foo` in code is a string with no preview, no validation, no rename refactor.
- SVG import is brittle: strokes, `clipPath`, `mask`, `use`, even-odd fills, groups with transforms — all silently mangled or dropped.
- Old app and new app each have features the other lacks (old: set management, quick-use, image export; new: layers, boolean ops, snapping, history branches).

## What we build

**Best-of-both IcoMoon**, plus three things IcoMoon structurally cannot do:

1. **Git-native project format** — folder of real `.svg` files + a `icons.json` manifest + a `codepoints.lock`. Reviewable in a PR.
2. **Deterministic CLI build** — same input, byte-identical font. Runs in CI. No browser.
3. **Editor-native workflow** — VSCode extension where the icon font is a first-class language feature.

## Non-goals (v1)

- General-purpose vector illustration (not a Figma/Inkscape).
- Text font design (kerning, hinting, variable axes, OpenType shaping beyond `liga`).
- Hosted accounts / cloud sync / "Quick Usage" CDN. Publishing is done by *your* git repo, not our server.
- Shipping third-party icon libraries as bundled data. We link **Iconify** at runtime and always carry per-icon license + attribution.

## Principles

- **Headless core, three shells.** Every capability exists as a pure TS function before it exists as a button.
- **Codepoints are an API.** Once assigned, never reassigned. Any change is a breaking change and surfaced as one.
- **Fixing beats rejecting.** Any SVG in, valid glyph out, with a lint report explaining every mutation.
- **No lossy round-trips.** Unknown fields in imported project files are preserved verbatim so re-export is safe.

## Licensing posture

- App: MIT (or Apache-2.0 for the patent grant — decide before first public commit).
- Imported icons keep their own license in per-icon metadata; export emits an aggregated `ATTRIBUTION.md`. This is a genuine legal pain point when mixing Material (Apache-2.0), Font Awesome Free (CC-BY-4.0 + OFL), and in-house icons — IcoMoon does not solve it.
