# 20 — Publishing: what to set up once

Three registries need an account and a token before a release can reach them. Everything
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

Fiddlier than it should be, because the marketplace authenticates through Azure DevOps.
Two things trip everyone up, and both are invisible until you hit them.

### You need an Azure DevOps organisation first

Not a company account, not a paid one, and nothing to do with Azure the cloud. The
*Personal access tokens* page does not exist until an organisation does, which is why
it cannot be found before this step.

1. **Check whether you already have one.** Sign in at <https://dev.azure.com>: if you
   belong to an organisation it drops you straight into it, and the name is in the URL
   (`dev.azure.com/{org}`). The complete list, including ones you were invited to, is at
   <https://app.vsaex.visualstudio.com/me>.
2. **If there is none**, select **New organization** — name (letters, digits and
   hyphens, starting with a letter or digit), hosting region, *Continue*.

   Microsoft's own documentation now lists *"an active Azure subscription"* as a
   prerequisite for creating a **new** organisation, though the free tier itself is
   unchanged. If that stops you, or a card is more than this is worth, skip to Open VSX
   below — it needs no Microsoft account at all.

### Then the token

3. Open <https://dev.azure.com/_usersSettings/tokens>, or the *User settings* dropdown
   next to your avatar → **Personal access tokens** → **New Token**.
4. **Organization: `All accessible organizations`.** A token scoped to one organisation
   cannot publish, and the failure is a bare `401` much later.
5. **Scopes: `Custom defined`** → click **`Show all scopes`** at the bottom of the list.
   Marketplace is *not* in the short list — this is the step that hides it — then scroll
   to **Marketplace** and tick **`Manage`**. `Acquire` and `Publish` are not enough.
6. *Create*, and copy the token: it is shown once.

### Then the publisher

7. <https://marketplace.visualstudio.com/manage/createpublisher>. The **ID must be
   exactly `iconotype`** — it is what `publisher` in `apps/vscode/package.json` says,
   and the two cannot disagree. The display name is free text.
8. Check it before trusting it: `npx @vscode/vsce login iconotype`, paste the token. It
   answers immediately, which beats finding out inside a release run.
9. Add it as the repository secret **`VSCE_PAT`**.

## Open VSX — for VSCodium and everything else

VSCodium, Gitpod, Cursor and the other non-Microsoft builds cannot install from the
Microsoft marketplace; they use <https://open-vsx.org>. Publishing there is a good idea
regardless, and its token needs **no Azure account at all**:

1. Sign in to <https://open-vsx.org> with GitHub.
2. Agree to the publisher agreement (Profile → *Publisher Agreement*) — a publish fails
   with `Publisher agreement not signed` otherwise.
3. Profile → **Access Tokens** → generate one.
4. Add it as the repository secret **`OVSX_PAT`**.
5. Claim the namespace once: `npx ovsx create-namespace iconotype -p <token>`.

The release publishes to whichever of the two has a token. If Azure is more trouble than
it is worth today, `OVSX_PAT` alone is a perfectly reasonable place to start — and it is
the one that covers the editor this project was developed in.

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
only touches them when a certificate is present.

## The auto-updater

The app checks `releases/latest/download/latest.json` four seconds after launch and
offers what it finds; nothing downloads or restarts without a click, because a tool
that replaces itself under an unsaved document is a tool that loses work.

It signs with its own key, unrelated to Apple's — Gatekeeper says the app may run,
minisign says the update came from you:

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/iconotype.key
```

The private key goes in `TAURI_SIGNING_PRIVATE_KEY` and its password — give it one, an
empty GitHub secret is rejected — in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The public
half is committed, at `plugins.updater.pubkey`. **Back the private key up.** It cannot
be recovered, and without it every installed copy rejects every future update: the only
remaining fix is asking people to download the app again by hand.

Updater artifacts are opt-in the same way signing is, and for a sharper reason:
`createUpdaterArtifacts` with no key in the environment stops the bundler dead and
takes the release with it. So it lives in `tauri.updater.conf.json`, which the workflow
merges over the main config only when `TAURI_SIGNING_PRIVATE_KEY` is set. A fork, a
local `pnpm bundle` and a release cut before the secrets exist all still work — they
ship no `latest.json`, and installed copies keep checking an endpoint that answers 404,
which the app treats as "nothing new" rather than as an error.

`latest.json` is assembled in the publish job rather than by `tauri-action`, which can
only write it when it is the thing creating the release. It is built from what the
bundler signed: a `.sig` beside a bundle means that bundle is an update artifact.

Note the ordering with macOS. An update replaces the `.app` in place, so shipping the
updater before the Developer ID signing above gets you an update that installs and then
will not open.

## The first release

```
Actions → release → Run workflow → bump: test
```

Cut a `test` first. It exercises every path — five manifests stamped, changelog
generated, four bundles, the `.vsix`, the npm package, all published together — while
landing on the pre-release channels where nobody is looking. Then `patch` promotes the
same number to a real release.
