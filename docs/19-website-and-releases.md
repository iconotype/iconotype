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

`release.yml`, on a `v*` tag or a manual run with a version:

1. **draft** — works out the version, collects the commits since the last tag, opens a
   *draft* release. A half-uploaded release people can already download is worse than
   no release, so nothing is public until everything has landed.
2. **desktop** — four bundles (macOS arm64 and x64, Linux, Windows) via
   `tauri-action`, uploaded to the draft.
3. **extension** — `.vsix` attached to the release, and published to the marketplace
   only if `VSCE_PAT` is set. A fork without secrets still produces something
   installable.
4. **cli** — `packages/cli/publish.mjs` assembles an npm package npm can actually
   take: the workspace manifest cannot be published as it stands, because its
   `@iconotype/*` dependencies are `workspace:*` and mean nothing outside this
   repository. The bundle already contains our own modules, so those vanish; the
   third-party ones stay, for the reasons `build.mjs` explains.
5. **publish** — flips the draft to latest.
6. **cleanup** — on failure, deletes the draft and the tag, so the version can be cut
   again.

`secrets` is not a context a step-level `if` can read, so both optional publishes take
their token through the job environment and test that instead.

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
