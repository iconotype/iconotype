# 20 — Publishing: what to set up once

Two registries need an account and a token before a release can reach them. Everything
else — the GitHub release, the four desktop bundles, the site — works with no setup at
all. A release with neither token still succeeds; it just publishes to GitHub only.

## npm — `@iconotype/cli`

The package is **scoped**, so two things follow: the `iconotype` organisation has to
exist, and every publish needs `--access public` (a scoped package is private by
default, and publishing one privately requires a paid plan — the workflow passes the
flag).

1. Create the org at <https://www.npmjs.com/org/create> — free for public packages.
   The name must be `iconotype`.
2. Create a token at <https://www.npmjs.com/settings/~/tokens>. A **granular access
   token** limited to `@iconotype/*` with *Read and write* is the right shape;
   *Automation* is the classic equivalent and bypasses 2FA, which a CI publish needs.
3. Add it to the repository as the secret **`NPM_TOKEN`**
   (Settings → Secrets and variables → Actions).

The workflow publishes with `--provenance`, which signs the tarball against the run
that produced it. That needs the `id-token: write` permission (the publish job has it)
and a public repository.

The binary stays `iconotype` whatever the package is called, so `npx @iconotype/cli
build` and a globally installed `iconotype build` are the same command.

## VSCode marketplace — `iconotype.iconotype-vscode`

This one is fiddlier than it should be, because the marketplace authenticates through
Azure DevOps rather than through GitHub.

1. **Create an Azure DevOps organisation** at <https://dev.azure.com> if you have none.
   Free. Its name does not matter and is never shown; it exists only to issue the token.
2. **Create the Personal Access Token.** In Azure DevOps: your avatar →
   *Personal access tokens* → *New Token*. Two settings matter, and both are easy to
   get wrong:
   - **Organization: `All accessible organizations`.** A token scoped to one
     organisation cannot publish; this is the single most common cause of a
     `401 Unauthorized` from `vsce`.
   - **Scopes: `Custom defined` → `Marketplace` → `Manage`.** *Acquire* and *Publish*
     are not enough.

   Expiry is up to a year; the release will start failing when it lapses, so it is
   worth a calendar entry.
3. **Create the publisher** at
   <https://marketplace.visualstudio.com/manage/createpublisher>. The **publisher ID
   must be exactly `iconotype`** — it is what `publisher` in `apps/vscode/package.json`
   says, and the two cannot disagree. The display name can be anything.
4. **Check the token before trusting it**: `npx @vscode/vsce login iconotype`, paste it,
   and it will tell you immediately whether it works. This is worth doing at a terminal
   rather than discovering it in a release run.
5. Add it to the repository as the secret **`VSCE_PAT`**.

### What the extension already has

`vsce` refuses to publish without some of this, and the marketplace page looks unfinished
without the rest. All of it is in place:

| | |
|---|---|
| `publisher` | `iconotype` — must match the publisher you create |
| `name`, `displayName`, `description` | set |
| `icon` | `media/icon.png`, 128×128 |
| `galleryBanner` | dark, matching the app |
| `categories`, `keywords` | set |
| `repository`, `homepage`, `bugs`, `qna` | set |
| `license` + `LICENSE` file | MIT |
| `README.md` | rendered as the marketplace page — **image URLs must be absolute**, since it is served from the marketplace's own origin, not from the repository |
| no `private: true` | `vsce` refuses a manifest marked private |

A prerelease (`test`) publishes with `--pre-release`, which the marketplace offers under
"Switch to Pre-Release Version". The marketplace rejects a semver prerelease suffix, so
the extension carries the plain `x.y.z` while npm and the GitHub release carry
`-test.N` — `scripts/version.mjs` handles that mapping.

## Optional: signed desktop builds

Without secrets the bundles are unsigned: macOS shows the Gatekeeper warning, Windows
SmartScreen complains. To sign, set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID` and `APPLE_PASSWORD`; the workflow
only touches them when a certificate is present. `TAURI_SIGNING_PRIVATE_KEY` and its
password are for the auto-updater, which is not wired up yet.

## The first release

```
Actions → release → Run workflow → bump: test
```

Cut a `test` first. It exercises every path — five manifests stamped, changelog
generated, four bundles, the `.vsix`, the npm package, all published together — while
landing on the pre-release channels where nobody is looking. Then `patch` promotes the
same number to a real release.
