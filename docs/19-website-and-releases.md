# 19 — The website, and shipping

## What is deployed where

One Pages site, two builds:

```
/<repo>/            the product page      apps/site
/<repo>/app/        the web app           apps/web
```

Both get the same `BASE_PATH` prefix, and the page links to the app with a relative
`./app/`, so the whole thing works from a repository subpath without either build
knowing the repository's name.

The product page is plain HTML and one stylesheet — no framework, no JavaScript. It is
a single document whose job is to be read before anyone has decided to try the thing;
every kilobyte of app code shipped there is spent on someone who has not asked for it
yet. It does not import the app's own stylesheet either: those tokens carry assumptions
about panes and density that a marketing page does not want.

## The web app is the app

Not a demo. The same Svelte UI as the desktop build, over the browser's storage:
projects live in OPFS and are reopened on the next visit, and the recents menu lists
them.

`Open…` and `Save` are real files where the browser can do it — the File System Access
API gives a handle, so ⌘S writes back to the file you opened rather than dropping a
second copy in Downloads. Firefox and Safari have no such API, so there the same two
buttons fall back to an upload and a download, which is what those browsers offer.
Nothing is uploaded anywhere in either case; there is no server.

## Releasing

`release.yml`, run by hand with a choice of `patch`, `minor`, `major` or `test`.

**One version, five places.** The root manifest, the desktop manifest, the Tauri config,
the Rust crate and the extension all carry it, and a release is one thing even though it
ships as four. `scripts/version.mjs` is the only writer: it computes the next number,
writes it everywhere, and generates the changelog entry from the conventional commits
since the last tag (`feat:`, `fix:`, `perf:`, a `!` or a `BREAKING CHANGE:` trailer).

`test` cuts a prerelease — `0.3.0-test.1`, then `-test.2` — and a later `patch`
*promotes* it to `0.3.0` rather than skipping a number. The VSCode marketplace refuses a
semver prerelease suffix, so the extension gets the plain `x.y.z` and is published with
`--pre-release`; npm gets the suffix and the `next` tag; the GitHub release is marked
prerelease. That mapping lives in the script so the workflow never reasons about it.

**Nothing ships until everything builds.** The four desktop bundles, the `.vsix` and the
npm package are produced as *artifacts*, and a single final job takes all of them and
publishes the GitHub release, the marketplace and npm together. There is no window in
which the desktop app exists and the extension does not.

If any build fails, `rollback` deletes the tag and force-pushes the branch back to the
commit before the release, so the same number can be cut again once it is fixed.

### Signing is opt-in, and has to be all-or-nothing

The first release attempt died on macOS with:

```
security: SecKeychainItemImport: One or more parameters passed to a function were not valid.
failed to bundle project: failed codesign application: failed to run command security import
```

Passing `APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}` with no such secret does
not leave the variable unset — it sets it to the empty string. The bundler sees the
variable, takes the signing path, and hands `security import` an empty certificate.

The variables are now written to `$GITHUB_ENV` by a step that only runs when there is a
certificate, so without secrets they are genuinely absent and the bundles come out
unsigned. Linux and Windows were unaffected, which is why two of four matrix legs went
green and made it look like a macOS toolchain problem.

## Building without releasing

`build.yml` produces the same installables and stops there: the `.vsix` and the assembled
site on every pull request, and desktop bundles on demand (`all`, `extension`, `desktop`,
`web`). Artifacts last 14 days, so a change can be handed to someone to try before any
version number exists. Desktop test builds are deliberately unsigned — trying a branch
should not require anyone's certificate.

## Caching

| what | how |
|---|---|
| pnpm store | `setup-node`'s `cache: pnpm` |
| `node_modules` | keyed on `pnpm-lock.yaml` — the link farm is the slow half of an install |
| Rust | `Swatinem/rust-cache` on `apps/desktop/src-tauri -> target`, keyed per target so the two macOS architectures do not evict each other |
| VSCode test build | `apps/vscode/.vscode-test` — otherwise every CI run downloads ~130 MB of editor |
| Vite | `node_modules/.vite`, with a restore-key on the lockfile so a source change still starts from a warm cache |

CI also runs `cargo check` on the desktop crate for every pull request, which is only
affordable because of the Rust cache — and is the difference between finding a broken
Rust side now or at release time.

## The demo loop

`pnpm demo` drives the real web app in a headless Chromium and writes frames to
`.demo-frames`; the dev server has to be up (`pnpm dev`). Nothing is composited — a
beat that stops being true stops appearing in the recording.

The camera is a CSS transform on `#app` rather than an ffmpeg crop, so a zoom
re-rasterizes the layout instead of enlarging pixels and the text stays sharp at 2×,
the way it would if you actually leaned in. The pointer is drawn in, because a headless
browser has no cursor to record.

Encoding, once the frames exist:

```bash
ffmpeg -y -framerate 12 -i .demo-frames/%05d.png \
  -vf "scale=1280:-2:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart -r 24 docs/media/demo.mp4

ffmpeg -y -framerate 12 -i .demo-frames/%05d.png \
  -vf "scale=860:-2:flags=lanczos,palettegen=max_colors=96:stats_mode=diff" /tmp/pal.png
ffmpeg -y -framerate 12 -i .demo-frames/%05d.png -i /tmp/pal.png \
  -lavfi "scale=860:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 docs/media/demo.gif
```

The GIF is what README shows: GitHub will not play an mp4 committed to a repository.
The mp4 is a quarter of the size at twice the resolution, so it is what the site and any
link unfurl should use.
