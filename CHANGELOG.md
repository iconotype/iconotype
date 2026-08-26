# Changelog

## 0.2.4 — 2026-08-26

### Features

- **vscode:** scope missing-icon reporting separately from usage (80b22e2)
- **vscode:** report icons the code asks for and the font does not have (bfd0d47)
- **vscode:** reuse the editor panel, and make icon usage reachable (fb31a6a)
- **io:** import older icon-font projects, and unsquash the empty sidebar (3dc804f)
- **site:** serve the demo GIF as well (5024e82)

### Fixes

- **vscode:** only a prefix the code writes can produce a missing icon (e57cb05)
- **vscode:** a module path is not an icon reference (9d525d1)
- **vscode:** re-resolve tree nodes before acting on them (77afef8)
- **io:** point $schema at a URL that exists (732d60c)

### Other

- **desktop:** catch Cargo.lock up to 0.2.3 (9cb30ac)

## 0.2.3 — 2026-08-24

### Features

- **site:** a page for each thing people search for (1ef2d74)
- **site:** make a shared link look like something (ae16708)
- **site:** a social preview card, generated from the project's own parts (73c0fd7)
- **site:** put the demo loop on the product page (5d259e8)
- **site:** the demo starts with the search and ends on a real page (126659d)
- **site:** search the libraries in the demo, and hold the camera still (f168afc)
- **site:** record the demo loop from the real app (85783ff)

### Fixes

- **ci:** both Macs were sent the same update (55eae5c)
- **site:** play the README loop at 20fps (c056df0)
- **export:** the snippets taught markup that renders nothing (c450c4f)
- **font:** WOFF could not be built in a browser at all (621bc1f)

## 0.2.2 — 2026-08-24

### Features

- **ci:** sign test builds by default (eec1153)
- **ci:** let the build workflow sign, and stop mangling the .app on the way out (e27c2c6)
- **desktop:** wire up the auto-updater (bdacab5)

### Fixes

- **ci:** a signed bundle failed the check that says it is signed (e7f1a27)
- **ci:** signing was gated on a condition that could never be true (cbc2b38)

### Other

- lead with what someone is searching for (3b31cbe)

## 0.2.1 — 2026-08-24

### Features

- **export:** tell people how to use the font, and where to put it (831dab8)

## 0.2.0 — 2026-08-24

### Features

- **ui:** a real title bar, resizable panels and keyboard navigation (dec4d11)

### Other

- remove glyphsmith compatibility as was never released (dd9528c)

## 0.1.0 — 2026-08-23

### Features

- search 230+ open icon libraries from the app, the editor and the CLI (6e7163f)
- **cli:** publish as @iconotype/cli, and write down the publishing setup (e7275a0)
- use the app mark for the extension and the web app (5a558b1)
- the product page, and workflows to ship everything (b21406e)
- **editor:** the glyph editor (9aacbfc)
- **desktop:** Tauri app, and a separate palette for the app and website (ae7d6db)
- Glyphsmith — icon font toolkit with a VSCode extension (d890174)

### Fixes

- **ci:** push the release tag, so the build jobs can check it out (df2932c)
- **ui:** stop the app changing things you did not ask it to (75dffa7)
- **ui:** overlapping cells, a destructive button under your cursor, and recents (329103a)
- **ui:** import our own project format, not just IcoMoon's (36c4bc4)

### Other

- where to find an existing Azure DevOps organisation (a9be908)
- how to actually get a marketplace token, and publish to Open VSX too (01ed56e)
- conventional releases, everything published together, and unsigned builds that build (276fed8)
- a README worth landing on, and deep links that make its screenshots reproducible (edaece2)
- bring the README in line with what shipped (7d8f015)
- install the spikes, so spike:paper actually has its dependencies (731013e)
- enable Pages from the workflow, and link the site from the README (e9bab33)
- **site:** real repo urls, direct download buttons, illustrated features (57a3457)
- rename Glyphsmith to Iconotype (ddf5504)
- activation cost notes (1301473)

