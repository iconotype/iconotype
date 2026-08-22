const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vscode = require('vscode')

const waitFor = (panel, type, ms = 20000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for "${type}"`)), ms)
    const d = panel.webview.onDidReceiveMessage((m) => {
      if (m.type === type) { clearTimeout(t); d.dispose(); res(m) }
    })
  })

suite('iconotype webview', function () {
  this.timeout(90000)

  // M5 moved panel creation behind the `iconotype.open` command, so the CSP and RPC
  // guarantees are re-verified through the same path a user takes.
  const ext = () => vscode.extensions.all.find((e) => e.id === 'iconotype.iconotype-vscode')

  const boot = async () => {
    const ext = vscode.extensions.all.find((e) => e.id === 'iconotype.iconotype-vscode')
    await ext.activate()

    // do not depend on another suite having run first: make sure a font exists
    if (!ext.exports.registry.fonts.some((f) => !f.error)) {
      const root = vscode.workspace.workspaceFolders[0].uri.fsPath
      const file = path.join(root, 'webview-fixture.iconotype.json')
      fs.writeFileSync(file, JSON.stringify({
        schemaVersion: 1,
        name: 'wv',
        font: { family: 'wv', prefix: 'wv-', emSize: 1024, baseline: 6.25, whitespace: 50, version: '1.0' },
        height: 1024,
        icons: [{ name: 'dot', code: 'e900', paths: ['M100 100H900V900H100Z'] }],
      }, null, 2))
      await ext.exports.registry.load(vscode.Uri.file(file))
    }
    // name the font explicitly: with several in the workspace, the command would
    // otherwise open a quick pick that nothing can answer in a headless run
    const font = ext.exports.registry.fonts.find((f) => !f.error)
    assert.ok(font, 'no icon font in the test workspace')
    const panel = await vscode.commands.executeCommand('iconotype.open', font.uri)
    assert.ok(panel, 'iconotype.open did not return a webview panel')
    const ready = await waitFor(panel, 'ready')
    return { panel, ready }
  }

  // Guards the whole "one Svelte UI in three shells" bet. If this breaks, M5 is in trouble.
  test('boots under the shipping CSP, themed, with a working asset base', async () => {
    const { panel, ready } = await boot()
    console.log('\n  assetBase :', ready.assetBase)
    console.log('  themeKind :', ready.themeKind)
    console.log('  body bg   :', ready.styled)
    assert.match(ready.assetBase, /^https:\/\/.*vscode-(cdn|webview)/, 'assetBase must be an asWebviewUri, not a relative path')
    assert.ok(ready.themeKind, 'no theme kind on body')
    assert.notStrictEqual(ready.styled, 'rgba(0, 0, 0, 0)', 'stylesheet did not apply — strict style-src rejected it?')
    panel.dispose()
  })

  /**
   * Opened from the extension, the panel used to render all five panels of the web
   * app — set list, grid, fix, export, history — in a fifth of the width each, three
   * of them duplicating the sidebar. Embedded it shows the glyph itself instead.
   */
  test('renders the embedded layout, not the full web app', async () => {
    const { panel, ready } = await boot()
    assert.strictEqual(ready.embedded, true, 'the panel did not mount in embedded mode')
    assert.strictEqual(ready.panels, 3, 'expected glyph detail + fix + history')
    panel.dispose()
  })

  // Exercises the real adapter chain: webview Host.fs → RPC → extension workspace.fs.
  /**
   * The editor must persist what it edits. Until M5.1 the panel received its project
   * but nothing sent changes back, so every edit made there was silently lost.
   */
  test('receives its project and writes edits back to the file', async () => {
    const { panel, ready } = await boot()
    void ready

    const font = ext().exports.registry.fonts.find((f) => !f.error)
    const before = JSON.parse(fs.readFileSync(font.uri.fsPath, 'utf8'))

    // make the edit INSIDE the webview, so the save travels the same path a user's
    // edit does: op → history → effect → postMessage → extension → file
    await panel.webview.postMessage({ type: 'test:edit', name: 'renamed-by-editor' })

    // the extension writes the file; wait for the watcher to settle
    for (let i = 0; i < 40; i++) {
      const current = JSON.parse(fs.readFileSync(font.uri.fsPath, 'utf8'))
      if (current.name === 'renamed-by-editor') break
      await new Promise((r) => setTimeout(r, 100))
    }
    const after = JSON.parse(fs.readFileSync(font.uri.fsPath, 'utf8'))
    assert.strictEqual(after.name, 'renamed-by-editor', 'the editor\'s change was not persisted')
    assert.strictEqual(after.icons.length, before.icons.length, 'the artwork must survive the round trip')

    // put it back
    fs.writeFileSync(font.uri.fsPath, JSON.stringify(before, null, 2))
    panel.dispose()
  })

  /**
   * The editor boots holding a placeholder project and its save effect runs on mount.
   * Before the token guard, opening the editor wrote that EMPTY font over the real
   * file — an imported project was destroyed by looking at it.
   */
  test('opening the editor never overwrites the project with an empty one', async () => {
    const font = ext().exports.registry.fonts.find((f) => !f.error)
    const before = fs.readFileSync(font.uri.fsPath, 'utf8')
    const beforeIcons = JSON.parse(before).icons.length
    assert.ok(beforeIcons > 0, 'the fixture must have icons for this to prove anything')

    const panel = await vscode.commands.executeCommand('iconotype.open', font.uri)
    await waitFor(panel, 'ready')
    // long enough for a save effect to have fired and been written
    await new Promise((r) => setTimeout(r, 1500))

    const after = JSON.parse(fs.readFileSync(font.uri.fsPath, 'utf8'))
    assert.strictEqual(after.icons.length, beforeIcons, 'the artwork was wiped by opening the editor')
    assert.notStrictEqual(after.name, 'iconotype', 'the placeholder project was written over the real one')
    panel.dispose()
  })

  test('a save without the panel token is ignored', async () => {
    const font = ext().exports.registry.fonts.find((f) => !f.error)
    const before = fs.readFileSync(font.uri.fsPath, 'utf8')

    const panel = await vscode.commands.executeCommand('iconotype.open', font.uri)
    await waitFor(panel, 'ready')
    await panel.webview.postMessage({
      type: 'test:rawSave',
      token: 'not-the-token',
      project: JSON.parse(JSON.stringify({
        schemaVersion: 1, id: 'x', name: 'hijacked', createdAt: 0,
        sets: [{ id: 's', name: 'S', height: 1024, prevSize: 32, hidden: false, metadata: {}, colorThemes: [], glyphs: [] }],
        preferences: ext().exports.registry.fonts[0].project.preferences,
        codepoints: {},
      })),
    })
    await new Promise((r) => setTimeout(r, 800))

    assert.strictEqual(fs.readFileSync(font.uri.fsPath, 'utf8'), before, 'an untokened save must not touch the file')
    panel.dispose()
  })

  /**
   * "Check all glyphs" dynamically imports core-svg (paper.js is 200 kB, so it is not
   * in the initial bundle). A nonce-only script-src blocks that import: the chunk the
   * browser fetches cannot carry a nonce, and it fails as "Failed to fetch dynamically
   * imported module".
   */
  test('can dynamically import a chunk under the shipping CSP', async () => {
    const { panel } = await boot()
    panel.webview.postMessage({ type: 'test:dynamicImport' })
    const result = await waitFor(panel, 'test:dynamicImportResult', 40000)
    assert.ok(result.ok, `a dynamic import was blocked: ${result.error}`)
    panel.dispose()
  })

  test('host RPC round-trip: webview Host.fs.exists → extension → back', async () => {
    const { panel } = await boot()

    panel.webview.postMessage({ type: 'test:hostCall', method: 'exists', args: ['/definitely/not/here'] })
    const missing = await waitFor(panel, 'test:hostResult')
    assert.strictEqual(missing.result, false, 'a missing path must resolve false, not throw')

    panel.webview.postMessage({ type: 'test:hostCall', method: 'exists', args: [__filename] })
    const present = await waitFor(panel, 'test:hostResult')
    assert.strictEqual(present.result, true, 'this very test file exists on disk')

    panel.dispose()
  })
})
