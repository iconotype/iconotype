# 10 — M0 scaffold

What exists now, and why each piece is shaped the way it is.

## Verification

| | result |
|---|---|
| `pnpm test` | 26 passing (5 files) |
| `pnpm test:vscode` | 3 passing, real VSCode 1.134.0 |
| `pnpm check` | 318 files, 0 errors |
| `pnpm build` | web 46.8 KB / 17.7 KB gzip · webview 48.4 KB / 18.1 KB gzip · extension 5.0 KB |
| web app | renders the empty-project shell with History panel |

## The six spike constraints, encoded

Prose constraints rot. Each is now a mechanism:

| # | Constraint | Where it lives |
|---|---|---|
| 1 | one paper instance | `packages/core-svg/src/paper.ts` is the only place that imports paper; `build-config` exports `paperAlias` for bundlers; `constraints.test.ts` asserts instance identity |
| 2 | `offsetStroke(p, d)` ⇒ width `2d` | `outlineStroke()` is the only caller and takes a real `strokeWidth`; test asserts area 20000 for a 1000×20 stroke |
| 3 | the shipping CSP | `build-config/webviewCsp()`; the extension test boots under **both** strict and relaxed |
| 4 | no relative fetch in a webview | `Host.assetBase()` is required on the interface, so a new host cannot forget it |
| 5 | no inline `<style>`/`<script>` | `assertNoInlineAssets()` vite plugin fails the build |
| 6 | `activate()` must return its API | done in `apps/vscode/src/extension.ts`, with the comment explaining the trap |

### One correction from M0

The original constraint 1 said "alias in every bundler **and vitest**". That is wrong, and the test caught it: under node, vitest externalizes dependencies, so the alias rewrites *our* imports but not `paperjs-offset`'s — manufacturing the exact two-instance failure it exists to prevent. Correct rule: **alias in bundlers, never in node.**

## Design notes

### History is a tree
`packages/core-model/src/history.ts`. Every op carries its own `inverse`, so undo is exact rather than a snapshot diff (test: a 3-op sequence undone deep-equals the original). Undoing then editing creates a **sibling branch** instead of discarding the redo — the abandoned branch stays reachable via `goto()`, which walks to the common ancestor applying inverses, then descends applying ops. That is IcoMoon's Branches panel, and it is 20 lines because the data structure is right.

### Core never calls `Date.now()`
Timestamps are injected by the shell (`SessionStore` takes a `now()`), so op sequences replay identically. Same discipline as the font builder's `timestamp` option. This is what makes deterministic builds and resumable history possible.

### Codepoints are append-only
`allocate()` refuses to touch a name that already has a codepoint, and never reuses a freed slot unless `{ reclaim: true }`. `codepoints.lock` is tab-separated, sorted by codepoint, hand-editable.

### One stylesheet, three hosts
`packages/ui/src/lib/theme.css` defines `--gs-*` tokens as `var(--vscode-*, fallback)`. VSCode supplies the variable; web and desktop take the fallback. No toolkit dependency, no per-host stylesheet.

## Known gaps (deliberate)

- `core-svg` is stages 4–6 only. Stages 1–3 and 7–13 are M3.
- `core-font` writes TTF; WOFF/WOFF2/EOT, ligatures and multicolor are M2.
- No importers yet — the empty state points at M1.
- No `cli` or `desktop` package yet (M4 / M6).
- `apps/vscode` is the webview harness only; the language features in [07](07-vscode-extension.md) are M5.
