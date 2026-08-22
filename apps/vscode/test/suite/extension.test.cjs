const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vscode = require('vscode')

/**
 * These run inside a real VSCode. Everything here goes through the actual extension
 * host — discovery, the filesystem, the language providers — because the interesting
 * failures in an extension are integration failures, not unit ones.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const FIXTURE = {
  schemaVersion: 1,
  name: 'app',
  font: { family: 'app', prefix: 'app-', emSize: 1024, baseline: 6.25, whitespace: 50, version: '1.0' },
  height: 1024,
  output: {
    fonts: { dir: 'app/fonts', formats: ['woff2', 'ttf'] },
    styles: [
      { kind: 'scss-variables', path: 'app/css/_icons.scss' },
      { kind: 'css', path: 'app/css/icons.css' },
    ],
  },
  icons: [
    { name: 'home', code: 'e900', paths: ['M100 100H900V900H100Z'], tags: ['home', 'house'] },
    { name: 'user', code: 'e901', paths: ['M512 100A200 200 0 1 1 512 500A200 200 0 1 1 512 100Z'] },
    { name: 'legacy', code: 'e902', selected: false, paths: ['M0 0H200V200H0Z'] },
  ],
}

let workspace
let api

const uri = (...parts) => vscode.Uri.file(path.join(workspace, ...parts))
const readText = (p) => fs.readFileSync(path.join(workspace, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(workspace, p))

suite('glyphsmith extension', function () {
  this.timeout(120000)

  suiteSetup(async () => {
    workspace = vscode.workspace.workspaceFolders[0].uri.fsPath
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'app.glyphsmith.json'), JSON.stringify(FIXTURE, null, 2))
    fs.writeFileSync(
      path.join(workspace, 'src', 'page.html'),
      '<i class="app-home"></i>\n<i class="app-home"></i>\n<span class="app-user"></span>\n',
    )

    const extension = vscode.extensions.all.find((e) => e.id === 'glyphsmith.glyphsmith-vscode')
    assert.ok(extension, 'extension not found')
    api = await extension.activate()
    await api.registry.initialize()
    await wait(500)
  })

  const appFont = () => {
    const font = api.registry.fonts.find((f) => f.name === 'app')
    assert.ok(font, 'the app font was not discovered')
    return font
  }

  test('discovers the icon fonts in the workspace', () => {
    const font = appFont()
    assert.strictEqual(font.prefix, 'app-')
    assert.strictEqual(font.project.sets[0].glyphs.length, 3)
    assert.ok(api.registry.fonts.length >= 1)
  })

  test('resolves a written reference back to its icon', () => {
    const icon = api.registry.resolve('app-home')
    assert.ok(icon, 'app-home did not resolve')
    assert.strictEqual(icon.glyph.name, 'home')
    assert.deepStrictEqual(icon.codepoints, [0xe900])
    assert.strictEqual(api.registry.resolve('app-nope'), undefined)
    assert.strictEqual(api.registry.resolve('other-home'), undefined)
  })

  test('honours per-icon selection', () => {
    const selected = api.registry.selected(appFont()).map((g) => g.name)
    assert.deepStrictEqual(selected, ['home', 'user'])
  })

  // The point of the whole extension: fonts and styles land where the bundler looks.
  test('exports fonts and styles straight to their configured paths', async () => {
    await api.exportFont(appFont())

    assert.ok(exists('app/fonts/app.woff2'), 'woff2 not written')
    assert.ok(exists('app/fonts/app.ttf'), 'ttf not written')
    assert.ok(exists('app/css/_icons.scss'), 'scss variables not written')
    assert.ok(exists('app/css/icons.css'), 'css not written')

    const scss = readText('app/css/_icons.scss')
    assert.match(scss, /\$app-home: "\\e900";/)
    assert.match(scss, /\$app-user: "\\e901";/)
    assert.doesNotMatch(scss, /legacy/, 'a deselected icon must not appear in the output')

    const css = readText('app/css/icons.css')
    assert.match(css, /url\('\.\.\/fonts\/app\.woff2'\)/, 'font url must be relative to the stylesheet')
    assert.doesNotMatch(css, /app\/fonts/, 'a project-root path would not resolve from the stylesheet')

    const ttf = fs.readFileSync(path.join(workspace, 'app/fonts/app.ttf'))
    assert.deepStrictEqual([...ttf.subarray(0, 4)], [0, 1, 0, 0], 'not a glyf TTF')
  })

  test('a second export writes identical bytes', async () => {
    const before = fs.readFileSync(path.join(workspace, 'app/fonts/app.woff2'))
    const stat = fs.statSync(path.join(workspace, 'app/fonts/app.woff2'))
    await wait(1100)
    await api.exportFont(appFont())
    const after = fs.readFileSync(path.join(workspace, 'app/fonts/app.woff2'))
    assert.deepStrictEqual(before, after, 'export is not reproducible')
    // unchanged bytes must not be rewritten, or every export dirties the working tree
    assert.strictEqual(fs.statSync(path.join(workspace, 'app/fonts/app.woff2')).mtimeMs, stat.mtimeMs)
  })

  test('completes icon names after the font prefix, excluding deselected ones', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'html',
      content: '<i class="app-',
    })
    const editor = await vscode.window.showTextDocument(document)
    const position = new vscode.Position(0, document.lineAt(0).text.length)
    const list = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider', document.uri, position,
    )
    const labels = list.items
      .map((i) => (typeof i.label === 'string' ? i.label : i.label.label))
      .filter((l) => l.startsWith('app-'))

    assert.ok(labels.includes('app-home'), `app-home missing from ${labels.join(', ')}`)
    assert.ok(labels.includes('app-user'))
    assert.ok(!labels.includes('app-legacy'), 'a deselected icon must not be suggested')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    void editor
  })

  test('hovers a reference with its codepoint', async () => {
    const document = await vscode.workspace.openTextDocument(uri('src/page.html'))
    await vscode.window.showTextDocument(document)
    const offset = document.getText().indexOf('app-home') + 2
    const hovers = await vscode.commands.executeCommand(
      'vscode.executeHoverProvider', document.uri, document.positionAt(offset),
    )
    const text = hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n')
    assert.match(text, /app-home/)
    assert.match(text, /U\+E900/)
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  })

  test('decorates references with the glyph itself', async () => {
    const document = await vscode.workspace.openTextDocument(uri('src/page.html'))
    // glyphs are rendered per document, not for the whole workspace at activation
    await api.decorator.warm(document)
    const decorations = api.decorator.decorationsFor(document)
    assert.strictEqual(
      decorations.length, 3,
      `expected one decoration per reference, got ${decorations.length}: ` +
        decorations.map((d) => document.getText(d.range)).join(', '),
    )
    // a cached SVG file, not a data URI: Uri.parse mangles the data mime type
    const icon = decorations[0].renderOptions.before.contentIconPath
    assert.strictEqual(icon.scheme, 'file')
    assert.match(icon.path, /\.svg$/)

    // and nothing else was rendered: activation used to write two files per glyph in
    // the workspace before the window was usable
    const unreferenced = api.registry.icons().find((i) => !document.getText().includes(i.glyph.name))
    if (unreferenced) {
      assert.strictEqual(
        api.decorator.iconPathFor(unreferenced), undefined,
        `${unreferenced.glyph.name} is not in this document and should not have been rendered`,
      )
    }
  })

  test('decorates a codepoint escape written directly in CSS', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'css',
      content: '.x:before { content: "\\e901"; }',
    })
    const decorations = api.decorator.decorationsFor(document)
    assert.strictEqual(decorations.length, 1)
  })

  test('scans the workspace for icon usage', async () => {
    await api.usage.scan()
    const home = api.usage.all().find((u) => u.icon.glyph.name === 'home')
    const user = api.usage.all().find((u) => u.icon.glyph.name === 'user')
    const legacy = api.usage.all().find((u) => u.icon.glyph.name === 'legacy')

    assert.strictEqual(home.sites.length, 2, 'home is referenced twice in page.html')
    assert.strictEqual(user.sites.length, 1)
    assert.strictEqual(legacy.sites.length, 0)
    assert.ok(api.usage.unused.some((u) => u.icon.glyph.name === 'legacy'))
    assert.match(home.sites[0].text, /app-home/)
  })

  test('the usage scan ignores the generated stylesheet', async () => {
    // icons.css names every icon; counting it would make everything look used
    await api.usage.scan()
    const user = api.usage.all().find((u) => u.icon.glyph.name === 'user')
    assert.ok(
      user.sites.every((s) => !s.uri.path.endsWith('icons.css')),
      'generated output must not count as usage',
    )
  })

  test('adds icons from SVG files and assigns the next free codepoint', async () => {
    const svg = path.join(workspace, 'star.svg')
    fs.writeFileSync(svg, '<svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"/></svg>')
    await api.addSvgFiles(appFont(), [vscode.Uri.file(svg)])
    await wait(400)

    const font = appFont()
    const added = font.project.sets[0].glyphs.find((g) => g.name === 'star')
    assert.ok(added, 'star was not added')
    assert.strictEqual(font.project.codepoints.star, 0xe903, 'must append past the highest codepoint')
    // and the existing ones must not move
    assert.strictEqual(font.project.codepoints.home, 0xe900)

    const onDisk = JSON.parse(readText('app.glyphsmith.json'))
    assert.ok(onDisk.icons.some((i) => i.name === 'star'), 'the project file was not updated')
  })

  test('toggling selection is written to the project file', async () => {
    const font = appFont()
    const legacy = font.project.sets[0].glyphs.find((g) => g.name === 'legacy')
    await vscode.commands.executeCommand('glyphsmith.toggleIcon', { font, glyph: legacy })
    await wait(400)

    const onDisk = JSON.parse(readText('app.glyphsmith.json'))
    const entry = onDisk.icons.find((i) => i.name === 'legacy')
    assert.ok(!('selected' in entry) || entry.selected === true, 'legacy should now be included')
    assert.ok(api.registry.selected(appFont()).some((g) => g.name === 'legacy'))
  })

  // The knobs IcoMoon exposes on its export panel, driven from the project file.
  test('honours the font export settings', async () => {
    const file = path.join(workspace, 'settings.glyphsmith.json')
    fs.writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      name: 'kit',
      font: {
        family: 'kit', prefix: 'kit-', postfix: '-${u}',
        emSize: 2048, baseline: 10, whitespace: 40, version: '2.3',
        propertyPerGlyph: true, glyphNames: false,
        metadata: { copyright: '(c) 2026 Example', url: 'https://example.com' },
      },
      height: 1024,
      output: {
        fonts: { dir: 'kit/fonts', formats: ['woff2'] },
        styles: [
          { kind: 'css', path: 'kit/css/kit.css' },
          { kind: 'dart', path: 'kit/lib/kit_icons.dart' },
        ],
      },
      icons: [{ name: 'star', code: 'e900', paths: ['M100 100H900V900H100Z'] }],
    }, null, 2))

    const font = await api.registry.load(vscode.Uri.file(file))
    await api.exportFont(font)

    const css = readText('kit/css/kit.css')
    assert.match(css, /\.kit-star-e900:before/, 'the ${u} suffix was not interpolated')
    assert.match(css, /--kit-star: "\\e900";/, 'propertyPerGlyph did not emit a custom property')

    const dart = readText('kit/lib/kit_icons.dart')
    assert.match(dart, /class Kit \{/)
    assert.match(dart, /static const IconData star = IconData\(0xe900, fontFamily: _family\);/)
    assert.match(dart, /family: kit/, 'the pubspec hint is missing')

    fs.unlinkSync(file)
    await wait(300)
  })

  test('renders the icon grid with selection state and a locked-down CSP', async () => {
    // set the state this test asserts on, rather than inheriting it from another test
    const font = appFont()
    const user = font.project.sets[0].glyphs.find((g) => g.name === 'user')
    await vscode.commands.executeCommand('glyphsmith.toggleIcon', { font, glyph: { ...user, selected: true } })
    await wait(400)

    const html = api.grid.renderHtml({ cspSource: 'vscode-resource:' })

    // every icon is drawn, and deselected ones are visibly marked
    assert.ok(html.includes('data-id='), 'no icon cells rendered')
    assert.match(html, /class="cell"[^>]*title="home/)
    assert.match(html, /class="cell excluded"[^>]*title="user/, 'the excluded icon is not marked')
    assert.match(html, /<img src="data:image\/svg\+xml;base64,/, 'glyph previews missing')

    // a cell opens the icon; the tick is what includes or excludes it
    assert.match(html, /class="check on"[^>]*data-toggle=/, 'an included icon needs a ticked box')
    assert.match(html, /class="check"[^>]*data-toggle=/, 'an excluded icon needs an empty box')
    assert.match(html, /class="cell[^"]*"[^>]*role="button"/, 'the cell itself must be activatable')
    assert.match(html, /click to open/, 'the hint must describe what a click does')

    // the same CSP discipline as everywhere else: nonced script, no remote anything
    assert.match(html, /default-src 'none'/)
    assert.match(html, /script-src 'nonce-[a-z0-9]+'/)
    assert.doesNotMatch(html, /<script(?![^>]*nonce)/, 'an un-nonced script would be blocked')

    // and the controls the panel promises
    for (const command of ['export', 'import', 'selectAll', 'selectNone', 'create']) {
      assert.ok(html.includes(`data-command="${command}"`) || command === 'create', `${command} control missing`)
    }
    assert.match(html, /selected for export/)
  })

  test('flags a reference to an icon that does not exist, and suggests the right one', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'html',
      content: '<i class="app-hme"></i><i class="app-home"></i>',
    })
    const found = api.diagnostics.diagnosticsFor(document)
    assert.strictEqual(found.length, 1, 'only the typo should be flagged')
    assert.match(found[0].message, /is not an icon in app/)
    assert.match(found[0].message, /Did you mean "app-home"/)
    assert.strictEqual(found[0].code, 'unknown-icon')
    assert.strictEqual(found[0].severity, vscode.DiagnosticSeverity.Warning)
  })

  test('flags an icon that exists but is excluded from the built font', async () => {
    const font = appFont()
    const user = font.project.sets[0].glyphs.find((g) => g.name === 'user')
    await vscode.commands.executeCommand('glyphsmith.toggleIcon', { font, glyph: { ...user, selected: true } })
    await wait(400)

    const document = await vscode.workspace.openTextDocument({
      language: 'html', content: '<i class="app-user"></i>',
    })
    const found = api.diagnostics.diagnosticsFor(document)
    assert.strictEqual(found.length, 1)
    assert.strictEqual(found[0].code, 'excluded-icon')
    assert.match(found[0].message, /will render nothing/)

    // put it back for the tests that follow
    await vscode.commands.executeCommand('glyphsmith.toggleIcon', {
      font: appFont(), glyph: { ...user, selected: false },
    })
    await wait(400)
  })

  test('offers the suggestion as a quick fix', async () => {
    const file = path.join(workspace, 'src', 'typo.html')
    fs.writeFileSync(file, '<i class="app-hme"></i>')
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file))
    await vscode.window.showTextDocument(document)

    // the code-action provider only sees diagnostics that were actually published
    api.diagnostics.refresh(document)
    await wait(300)

    const diagnostic = api.diagnostics.diagnosticsFor(document)[0]
    const actions = await vscode.commands.executeCommand(
      'vscode.executeCodeActionProvider', document.uri, diagnostic.range,
    )
    const titles = (actions ?? []).map((a) => a.title)
    assert.ok(
      titles.includes('Replace with "app-home"'),
      `no quick fix offered; got ${titles.join(', ') || 'none'}`,
    )
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    fs.unlinkSync(file)
  })

  // Renaming must keep the codepoint, or every shipped build renders the wrong glyph.
  test('renames an icon everywhere, keeping its codepoint', async () => {
    const document = await vscode.workspace.openTextDocument(uri('src/page.html'))
    await vscode.window.showTextDocument(document)
    const offset = document.getText().indexOf('app-user') + 2
    const edit = await vscode.commands.executeCommand(
      'vscode.executeDocumentRenameProvider', document.uri, document.positionAt(offset), 'app-profile',
    )
    assert.ok(edit, 'no rename edit produced')
    const touched = edit.entries().map(([target]) => target.path)
    assert.ok(
      touched.some((p) => p.endsWith('page.html')),
      `the rename did not touch any source file; it edited: ${touched.join(', ')}`,
    )
    assert.ok(await vscode.workspace.applyEdit(edit), 'the rename edit did not apply')

    // A rename leaves every touched file dirty, exactly like a TypeScript refactor.
    // Save them explicitly before reading from disk.
    for (const [target] of edit.entries()) {
      await (await vscode.workspace.openTextDocument(target)).save()
    }
    await wait(500)
    await wait(600)

    const html = readText('src/page.html')
    assert.match(html, /app-profile/, 'the reference was not renamed')
    assert.doesNotMatch(html, /app-user/, 'an old reference was left behind')

    const onDisk = JSON.parse(readText('app.glyphsmith.json'))
    const renamed = onDisk.icons.find((i) => i.name === 'profile')
    assert.ok(renamed, 'the project file was not updated')
    assert.strictEqual(renamed.code, 'e901', 'the codepoint must NOT move on a rename')
    assert.ok(!onDisk.icons.some((i) => i.name === 'user'), 'the old name is still there')
  })

  test('finds every reference to an icon', async () => {
    const document = await vscode.workspace.openTextDocument(uri('src/page.html'))
    const offset = document.getText().indexOf('app-home') + 2
    const locations = await vscode.commands.executeCommand(
      'vscode.executeReferenceProvider', document.uri, document.positionAt(offset),
    )
    assert.ok(locations.length >= 2, `expected at least 2 references, got ${locations.length}`)
  })

  test('jumps from a reference to the icon in the project file', async () => {
    const document = await vscode.workspace.openTextDocument(uri('src/page.html'))
    const offset = document.getText().indexOf('app-home') + 2
    const targets = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider', document.uri, document.positionAt(offset),
    )
    assert.ok(targets.length >= 1)
    const target = targets[0].uri ?? targets[0].targetUri
    assert.match(target.path, /app\.glyphsmith\.json$/)
  })

  test('keeps the usage index current when a file is saved', async () => {
    await api.usage.scan()
    const before = api.usage.all().find((u) => u.icon.glyph.name === 'home').sites.length
    assert.ok(before > 0)

    api.usage.updateFile(uri('src/page.html'), '<div>no icons here</div>')
    const after = api.usage.all().find((u) => u.icon.glyph.name === 'home').sites.length
    assert.strictEqual(after, 0, 'the index still reports references from the old content')
  })

  test('registers every contributed command', async () => {
    const commands = await vscode.commands.getCommands(true)
    const extension = vscode.extensions.all.find((e) => e.id === 'glyphsmith.glyphsmith-vscode')
    // read the manifest rather than a hand-kept list: a contributed-but-unregistered
    // command is a silent "command not found" the first time a user clicks it
    const contributed = extension.packageJSON.contributes.commands.map((c) => c.command)
    assert.ok(contributed.length >= 12)
    for (const name of contributed) {
      assert.ok(commands.includes(name), `${name} is contributed but not registered`)
    }
  })

  test('keeps a broken project file visible instead of dropping it', async () => {
    const broken = path.join(workspace, 'broken.glyphsmith.json')
    fs.writeFileSync(broken, '{ not json')
    const font = await api.registry.load(vscode.Uri.file(broken))
    assert.ok(font.error, 'a parse failure must be reported on the font')
    assert.ok(api.registry.fonts.some((f) => f.error), 'the broken font must still be listed')
    fs.unlinkSync(broken)
  })
  // ── importing ────────────────────────────────────────────────────────────────

  const ICOMOON = {
    metadata: { name: 'legacy' },
    iconSets: [{
      id: 0,
      metadata: { name: 'legacy set' },
      height: 1024,
      prevSize: 32,
      icons: [
        { id: 0, paths: ['M0 0H512V512H0Z'], attrs: [], grid: 16, tags: ['compass'], isMulticolor: false },
        { id: 1, paths: ['M0 0H256V256H0Z'], attrs: [], grid: 16, tags: ['home'], isMulticolor: false },
      ],
      selection: [
        { order: 1, id: 0, name: 'compass', prevSize: 32, code: 0xe950, ligatures: '' },
        { order: 2, id: 1, name: 'home', prevSize: 32, code: 0xe951, ligatures: '' },
      ],
    }],
    preferences: { fontPref: { prefix: 'legacy-', metadata: { fontFamily: 'legacy' } } },
  }

  test('reads an IcoMoon project file, keeping its codepoints exactly', async () => {
    const file = path.join(workspace, 'legacy.icomoon.json')
    fs.writeFileSync(file, JSON.stringify(ICOMOON))
    const source = await api.readImportable(vscode.Uri.file(file))

    const names = source.project.sets.flatMap((s) => s.glyphs).map((g) => g.name)
    assert.deepStrictEqual(names.sort(), ['compass', 'home'])
    // the codepoints are the font's API — importing must not renumber them
    assert.strictEqual(source.project.codepoints.compass, 0xe950)
    assert.strictEqual(source.project.codepoints.home, 0xe951)
  })

  test('reads a folder of SVG files', async () => {
    const dir = path.join(workspace, 'svgs')
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'alpha.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="10" height="10"/></svg>')
    fs.writeFileSync(path.join(dir, 'nested', 'beta.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>')

    const source = await api.readImportable(vscode.Uri.file(dir))
    const names = source.project.sets.flatMap((s) => s.glyphs).map((g) => g.name).sort()
    assert.deepStrictEqual(names, ['alpha', 'beta'], 'nested SVGs must be found too')
  })

  test('rejects a file that is not a project, with a message naming it', async () => {
    const file = path.join(workspace, 'not-a-project.json')
    fs.writeFileSync(file, '{"hello":"world"}')
    await assert.rejects(
      () => api.readImportable(vscode.Uri.file(file)),
      (e) => /not-a-project\.json: not an IcoMoon or Glyphsmith project/.test(e.message),
    )
  })

  test('merges another project into an existing font without disturbing it', async () => {
    const file = path.join(workspace, 'legacy.icomoon.json')
    fs.writeFileSync(file, JSON.stringify(ICOMOON))
    const source = await api.readImportable(vscode.Uri.file(file))

    const font = appFont()
    const before = font.project.sets[0].glyphs.length
    const homeCode = font.project.codepoints.home

    const result = await api.mergeIntoFont(api.registry, font, source)

    // `home` already exists here, so it is left alone rather than overwritten
    assert.deepStrictEqual(result.skipped, ['home'])
    assert.deepStrictEqual(result.added.map((g) => g.name), ['compass'])

    const after = appFont()
    assert.strictEqual(after.project.sets[0].glyphs.length, before + 1)
    assert.strictEqual(after.project.codepoints.home, homeCode, 'an existing codepoint must not move')
    // e950 was free in the target, so the source's own codepoint carries over
    assert.strictEqual(after.project.codepoints.compass, 0xe950)

    await api.registry.save(after, {
      ...after.project,
      sets: after.project.sets.map((s) => ({ ...s, glyphs: s.glyphs.filter((g) => g.name !== 'compass') })),
    })
  })

  test('allocates a fresh codepoint when the source codepoint is taken', async () => {
    const clash = JSON.parse(JSON.stringify(ICOMOON))
    clash.iconSets[0].selection[0].name = 'anchor'
    clash.iconSets[0].icons[0].tags = ['anchor']
    clash.iconSets[0].selection[0].code = 0xe900 // already `home` in the target font
    const file = path.join(workspace, 'clash.icomoon.json')
    fs.writeFileSync(file, JSON.stringify(clash))

    const font = appFont()
    const result = await api.mergeIntoFont(api.registry, font, await api.readImportable(vscode.Uri.file(file)))
    assert.ok(result.added.some((g) => g.name === 'anchor'))

    const after = appFont()
    assert.strictEqual(after.project.codepoints.home, 0xe900, 'the target keeps its own codepoint')
    assert.notStrictEqual(after.project.codepoints.anchor, 0xe900, 'the clashing import must be reallocated')

    await api.registry.save(after, {
      ...after.project,
      sets: after.project.sets.map((s) => ({ ...s, glyphs: s.glyphs.filter((g) => g.name !== 'anchor') })),
    })
  })

  test('applies the wizard answers, keeping the imported codepoints', async () => {
    const file = path.join(workspace, 'legacy.icomoon.json')
    fs.writeFileSync(file, JSON.stringify(ICOMOON))
    const source = await api.readImportable(vscode.Uri.file(file))

    const { project } = api.prepareImported(source, {
      name: 'brand',
      prefix: 'brand-',
      fontsDir: 'app/fonts/',
      stylesDir: 'app/css/',
      styleKind: 'scss-variables',
      target: uri('brand.glyphsmith.json'),
    })

    assert.strictEqual(project.name, 'brand')
    assert.strictEqual(project.preferences.font.family, 'brand')
    assert.strictEqual(project.preferences.font.prefix, 'brand-')
    // the same layout `glyphsmith init` writes, from the same helper
    assert.strictEqual(project.output.fonts.dir, 'app/fonts')
    assert.deepStrictEqual(project.output.styles, [{ kind: 'scss-variables', path: 'app/css/_brand.scss' }])
    // renaming the font must not renumber anything
    assert.strictEqual(project.codepoints.compass, 0xe950)
    assert.strictEqual(project.codepoints.home, 0xe951)
  })

  test('groups usage into used and unused, with locations under each icon', async () => {
    await api.usage.scan()
    const tree = api.usageTree
    const groups = tree.getChildren()
    const used = groups.find((g) => g.used)
    assert.ok(used, 'no "Used" group — a referenced icon must be visible without hunting')

    const item = tree.getTreeItem(used)
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded)

    const icons = tree.getChildren(used).map((n) => n.usage.icon.glyph.name)
    assert.ok(icons.includes('home'), `home is referenced in src/page.html but is not in ${icons}`)

    const homeNode = tree.getChildren(used).find((n) => n.usage.icon.glyph.name === 'home')
    const sites = tree.getChildren(homeNode)
    assert.strictEqual(sites.length, 2, 'both references in page.html must be listed')
    const site = tree.getTreeItem(sites[0])
    assert.match(site.description, /page\.html:\d+/)
    assert.strictEqual(site.command.command, 'vscode.open')
  })

  test('spots a prefix the code uses that the font does not', async () => {
    fs.writeFileSync(
      path.join(workspace, 'src', 'legacy.html'),
      ['<i class="mdi-home"></i>', '<i class="mdi-user"></i>', '<i class="mdi-home"></i>'].join('\n'),
    )
    const other = path.join(workspace, 'other.glyphsmith.json')
    fs.writeFileSync(other, JSON.stringify({
      schemaVersion: 1,
      name: 'other',
      font: { family: 'other', prefix: 'other-', emSize: 1024, baseline: 6.25, whitespace: 50, version: '1.0' },
      height: 1024,
      icons: [
        { name: 'home', code: 'e910', paths: ['M0 0H10V10H0Z'] },
        { name: 'user', code: 'e911', paths: ['M0 0H10V10H0Z'] },
      ],
    }, null, 2))
    await api.registry.load(vscode.Uri.file(other))
    await api.usage.scan()

    const guess = api.usage.likelyPrefix('other')
    assert.ok(guess, 'no candidate prefix found')
    assert.strictEqual(guess.prefix, 'mdi-')
    assert.ok(guess.count >= 3, `expected at least 3 hits, got ${guess.count}`)

    fs.unlinkSync(other)
    fs.unlinkSync(path.join(workspace, 'src', 'legacy.html'))
    await api.usage.scan()
  })

  test('finds references in ts, js and svelte, not just markup', async () => {
    fs.mkdirSync(path.join(workspace, 'src', 'lib'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'src', 'icons.ts'),
      "export const ICON = 'app-profile';\nexport const other = \"app-home\";\n")
    fs.writeFileSync(path.join(workspace, 'src', 'lib', 'Widget.svelte'),
      '<script>const icon = `app-profile`</script>\n<i class="app-profile"></i>\n')
    fs.writeFileSync(path.join(workspace, 'src', 'legacy.js'),
      "el.className = 'app-home'\n")

    await api.usage.scan()
    // scope to the app font: another fixture font in this workspace has the same names
    const byName = (n) => api.usage.all().find((u) => u.icon.font.name === 'app' && u.icon.glyph.name === n)

    const profile = byName('profile')
    const files = new Set(profile.sites.map((s) => path.basename(s.uri.fsPath)))
    assert.ok(files.has('icons.ts'), `a .ts reference was missed: ${[...files]}`)
    assert.ok(files.has('Widget.svelte'), `a .svelte reference was missed: ${[...files]}`)
    assert.ok(byName('home').sites.some((s) => s.uri.fsPath.endsWith('legacy.js')), 'a .js reference was missed')

    // and the scan says how much it actually read, so a partial answer cannot pass
    // for a complete one
    assert.ok(api.usage.report.files > 0)
    assert.strictEqual(api.usage.report.truncated, false)

    fs.rmSync(path.join(workspace, 'src', 'icons.ts'))
    fs.rmSync(path.join(workspace, 'src', 'legacy.js'))
    fs.rmSync(path.join(workspace, 'src', 'lib'), { recursive: true })
    await api.usage.scan()
  })

  test('replaces artwork without touching the name or the codepoint', async () => {
    const svg = path.join(workspace, 'replacement.svg')
    fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>')

    const font = appFont()
    // 'user' was renamed to 'profile' by the rename test above
    const before = font.project.sets[0].glyphs.find((g) => g.name === 'profile')
    const beforePath = before.paths[0]

    // the dialog cannot be answered headlessly, so answer it with the fixture
    const shown = vscode.window.showOpenDialog
    vscode.window.showOpenDialog = async () => [vscode.Uri.file(svg)]
    try {
      await vscode.commands.executeCommand('glyphsmith.replaceIcon', { font, glyph: before })
    } finally {
      vscode.window.showOpenDialog = shown
    }
    await wait(300)

    const after = appFont().project.sets[0].glyphs.find((g) => g.name === 'profile')
    assert.notStrictEqual(after.paths[0], beforePath, 'the artwork did not change')
    assert.strictEqual(appFont().project.codepoints.profile, 0xe901, 'the codepoint must not move')

    fs.unlinkSync(svg)
  })

  test('flattens a multicolor icon and releases its extra codepoints', async () => {
    const file = path.join(workspace, 'multi.glyphsmith.json')
    fs.writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      name: 'multi',
      font: { family: 'multi', prefix: 'multi-', emSize: 1024, baseline: 6.25, whitespace: 50, version: '1.0' },
      height: 1024,
      icons: [{
        name: 'cycling',
        code: 'e916',
        codes: ['e917', 'e918'],
        colors: ['#e00', '#0e0', '#00e'],
        paths: ['M0 0h10v10h-10z', 'M20 0h10v10h-10z', 'M40 0h10v10h-10z'],
      }],
    }, null, 2))
    const font = await api.registry.load(vscode.Uri.file(file))
    const glyph = font.project.sets[0].glyphs[0]
    assert.ok(glyph.isMulticolor, 'the fixture must start multicolor')

    const shown = vscode.window.showWarningMessage
    vscode.window.showWarningMessage = async () => 'Flatten'
    try {
      await vscode.commands.executeCommand('glyphsmith.flattenIcon', { font, glyph })
    } finally {
      vscode.window.showWarningMessage = shown
    }
    await wait(300)

    const after = api.registry.get(vscode.Uri.file(file)).project
    assert.strictEqual(after.sets[0].glyphs[0].isMulticolor, false)
    assert.strictEqual(after.codepoints.cycling, 0xe916, 'the first codepoint is the one that must survive')
    assert.strictEqual(after.sets[0].glyphs[0].paths.length, 3, 'the artwork must survive as subpaths')

    fs.unlinkSync(file)
  })

  test('the grid shows colour and multicolor state, a context menu and font settings', () => {
    const html = api.grid.renderHtml({ cspSource: 'vscode-resource:' })
    assert.ok(html.includes('data-action="usage"'), 'no context menu')
    assert.ok(html.includes('data-action="replace"'))
    assert.ok(html.includes('data-setting="prefix"'), 'no font settings panel')
    assert.ok(html.includes('data-setting="fontsDir"'))
    assert.ok(/<details class="settings">/.test(html), 'settings must be collapsed by default')
    assert.ok(!/<details class="settings" open>/.test(html))
  })

  test('honours a usage prefix that differs from the class prefix', async () => {
    const file = path.join(workspace, 'aliased.glyphsmith.json')
    fs.writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      name: 'aliased',
      // the stylesheet declares `.icon-…`, but a webpack alias means the code writes `alp-…`
      font: {
        family: 'aliased', prefix: 'icon-', usagePrefixes: ['alp-'],
        emSize: 1024, baseline: 6.25, whitespace: 50, version: '1.0',
      },
      height: 1024,
      icons: [{ name: 'summit', code: 'e930', paths: ['M0 0H10V10H0Z'] }],
    }, null, 2))
    await api.registry.load(vscode.Uri.file(file))

    const font = api.registry.fonts.find((f) => f.name === 'aliased')
    assert.strictEqual(font.prefix, 'alp-', 'the code prefix is what tooling writes')
    assert.strictEqual(font.classPrefix, 'icon-')
    assert.deepStrictEqual([...font.prefixes].sort(), ['alp-', 'icon-'])

    // both forms resolve to the same icon
    assert.strictEqual(api.registry.resolve('alp-summit')?.glyph.name, 'summit')
    assert.strictEqual(api.registry.resolve('icon-summit')?.glyph.name, 'summit')

    fs.writeFileSync(path.join(workspace, 'src', 'aliased.ts'), "const a = 'alp-summit'\n")
    fs.writeFileSync(path.join(workspace, 'src', 'aliased.scss'), '.icon-summit { color: red }\n')
    await api.usage.scan()

    const found = api.usage.all().find((u) => u.icon.font.name === 'aliased' && u.icon.glyph.name === 'summit')
    const files = new Set(found.sites.map((s) => path.basename(s.uri.fsPath)))
    assert.ok(files.has('aliased.ts'), 'the aliased prefix was not searched for')
    assert.ok(files.has('aliased.scss'), 'the class prefix must still count')
    // each site remembers how it was written, so a rename rewrites it in place
    assert.deepStrictEqual(
      new Set(found.sites.map((s) => s.prefix)), new Set(['alp-', 'icon-']))

    fs.unlinkSync(path.join(workspace, 'src', 'aliased.ts'))
    fs.unlinkSync(path.join(workspace, 'src', 'aliased.scss'))
    fs.unlinkSync(file)
    await api.usage.scan()
  })

  test('excludes are configurable', async () => {
    const { DEFAULT_EXCLUDE_DIRS, excludeGlobFor } = api.usageInternals
    assert.ok(DEFAULT_EXCLUDE_DIRS.includes('platforms'), 'the generated-source dirs must be excluded by default')
    assert.strictEqual(excludeGlobFor(['a', 'b']), '**/{a,b}/**')
    // tolerant of a user writing the glob form in the directory list
    assert.strictEqual(excludeGlobFor(['**/a/**', 'a', 'b ']), '**/{a,b}/**')
    assert.strictEqual(excludeGlobFor([]), '')

    // and the declared default matches what the code actually uses
    const extension = vscode.extensions.all.find((e) => e.id === 'glyphsmith.glyphsmith-vscode')
    const declared = extension.packageJSON.contributes.configuration.properties['glyphsmith.usage.excludeDirs'].default
    assert.deepStrictEqual(declared, DEFAULT_EXCLUDE_DIRS)
  })

  test('knows when the generated files no longer match the project', async () => {
    const font = appFont()
    await api.exports.refresh()

    await vscode.commands.executeCommand('glyphsmith.export', font.uri)
    await wait(400)
    await api.exports.refresh()
    assert.strictEqual(api.exports.isStale(appFont()), false, 'a font is not stale right after exporting it')

    // an edit that changes the output marks it pending
    const edited = appFont()
    const glyph = edited.project.sets[0].glyphs[0]
    await api.registry.save(edited, {
      ...edited.project,
      sets: edited.project.sets.map((set) => ({
        ...set,
        glyphs: set.glyphs.map((g) => (g.id === glyph.id ? { ...g, paths: ['M0 0H700V700H0Z'] } : g)),
      })),
    })
    await api.exports.refresh()
    assert.strictEqual(api.exports.isStale(appFont()), true, 'changed artwork must mark the font as pending')

    // and exporting clears it again
    await vscode.commands.executeCommand('glyphsmith.exportPending')
    await wait(400)
    await api.exports.refresh()
    assert.strictEqual(api.exports.isStale(appFont()), false)
  })

  test('an edit that cannot change the output does not mark it pending', async () => {
    await vscode.commands.executeCommand('glyphsmith.export', appFont().uri)
    await wait(400)
    await api.exports.refresh()
    assert.strictEqual(api.exports.isStale(appFont()), false)

    const font = appFont()
    const glyph = font.project.sets[0].glyphs[0]
    await api.registry.save(font, {
      ...font.project,
      sets: font.project.sets.map((set) => ({
        ...set,
        glyphs: set.glyphs.map((g) => (g.id === glyph.id ? { ...g, tags: ['a-new-tag'] } : g)),
      })),
    })
    await api.exports.refresh()
    assert.strictEqual(api.exports.isStale(appFont()), false, 'a tag is not part of the build')
  })

  test('a missing output file is stale whatever the stamp says', async () => {
    await vscode.commands.executeCommand('glyphsmith.export', appFont().uri)
    await wait(400)
    await api.exports.refresh()
    assert.strictEqual(api.exports.isStale(appFont()), false)

    // exactly what a fresh clone looks like when the build output is gitignored
    fs.rmSync(path.join(workspace, 'app', 'fonts', 'app.woff2'))
    await api.exports.refresh()
    assert.strictEqual(api.exports.isStale(appFont()), true)

    await vscode.commands.executeCommand('glyphsmith.exportPending')
    await wait(400)
    await api.exports.refresh()
    assert.ok(exists('app/fonts/app.woff2'))
  })

  test('the pending state reaches the sidebar', async () => {
    const font = appFont()
    const glyph = font.project.sets[0].glyphs[0]
    await api.registry.save(font, {
      ...font.project,
      sets: font.project.sets.map((set) => ({
        ...set,
        glyphs: set.glyphs.map((g) => (g.id === glyph.id ? { ...g, paths: ['M0 0H640V640H0Z'] } : g)),
      })),
    })
    await api.exports.refresh()

    // the grid shows one font at a time; make sure it is the one we just dirtied
    api.grid.show(appFont())
    const html = api.grid.renderHtml({ cspSource: 'vscode-resource:' })

    /**
     * The pending state marks the Export button that is already in the toolbar. It
     * must NOT add anything above the grid: a banner appearing the moment you change
     * an icon pushes every cell down, and the next tick you meant to click has moved.
     */
    assert.match(html, /class="primary pending"[^>]*data-command="export"/, 'the Export button must be marked')
    assert.match(html, /out of date/, 'the state must be stated somewhere')
    const beforeGrid = html.slice(0, html.indexOf('<div class="grid"'))
    const afterBar = beforeGrid.slice(beforeGrid.lastIndexOf('</div>'))
    assert.ok(!/<div[^>]*>/.test(afterBar), 'nothing new may be inserted between the toolbar and the grid')

    const node = api.fontTree.getChildren().find((n) => n.font.name === 'app')
    const item = await api.fontTree.getTreeItem(node)
    assert.match(item.description, /export pending/)

    await vscode.commands.executeCommand('glyphsmith.exportPending')
    await wait(400)
  })

  test('the generated stylesheet is a link, not a use', async () => {
    await vscode.commands.executeCommand('glyphsmith.export', appFont().uri)
    await wait(400)

    // a stylesheet from BEFORE this was a Glyphsmith project: not at a configured
    // output path, but still generated, and it names every icon
    fs.mkdirSync(path.join(workspace, 'legacy-css'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'legacy-css', 'icomoon.css'), [
      '/* generated by IcoMoon */',
      "@font-face { font-family: 'app'; src: url('../app/fonts/app.woff2') format('woff2'); }",
      '.app-home:before { content: "\\e900"; }',
      '.app-profile:before { content: "\\e901"; }',
    ].join('\n'))

    await api.usage.scan()
    const home = api.usage.all().find((u) => u.icon.font.name === 'app' && u.icon.glyph.name === 'home')
    assert.ok(
      home.sites.every((s) => !s.uri.path.endsWith('icomoon.css')),
      'a generated stylesheet must not count as usage',
    )

    const generated = api.usage.generatedFor(appFont()).map((u) => vscode.workspace.asRelativePath(u))
    assert.ok(generated.some((p) => p.endsWith('_icons.scss')), `configured output missing from ${generated}`)
    assert.ok(generated.some((p) => p.endsWith('icomoon.css')), `detected output missing from ${generated}`)

    const groups = api.usageTree.getChildren()
    const group = groups.find((g) => g.kind === 'generatedGroup')
    assert.ok(group, 'the usage view must offer the generated files')
    const first = api.usageTree.getTreeItem(api.usageTree.getChildren(group)[0])
    assert.strictEqual(first.command.command, 'vscode.open', 'the entry must open the file')

    fs.rmSync(path.join(workspace, 'legacy-css'), { recursive: true })
    await api.usage.scan()
  })

  test('activates without loading the font and SVG toolchains', async () => {
    /**
     * paper.js, svg2ttf and the WOFF2 encoder are 2.7 MB of the 2.8 MB bundle and are
     * needed by nothing that opening a window does. They live in a second file that is
     * required on the first import, fix or export — this is what keeps that true.
     *
     * The suite has exported by now, so the check is that the split EXISTS at all:
     * `dist/heavy.js` is a separate file, and the entry does not contain paper.
     */
    const root = path.join(__dirname, '..', '..')
    const entry = fs.readFileSync(path.join(root, 'dist', 'extension.js'), 'utf8')
    const heavy = fs.readFileSync(path.join(root, 'dist', 'heavy.js'), 'utf8')

    assert.ok(entry.length < 400_000, `the activation bundle grew to ${(entry.length / 1024) | 0} KB`)
    assert.ok(heavy.length > 1_000_000, 'the heavy half should hold the toolchains')
    assert.ok(!/Paper\.js v0\./.test(entry), 'paper.js must not be in the activation bundle')
    assert.ok(/Paper\.js v0\./.test(heavy), 'paper.js should be in the deferred bundle')
    assert.match(entry, /import\(["']\.\/heavy\.js["']\)/, 'the entry must reach the heavy half lazily')
  })

  test('offers importing from the grid toolbar and from an empty workspace', () => {
    const html = api.grid.renderHtml({ cspSource: 'vscode-resource:' })
    assert.ok(html.includes('data-command="importIcons"'), 'the grid must offer merging a project in')

    const empty = new (Object.getPrototypeOf(api.grid).constructor)(
      { fonts: [], onDidChange: () => ({ dispose() {} }), get: () => undefined, selected: () => [] },
      () => {},
    )
    const emptyHtml = empty.renderHtml({ cspSource: 'vscode-resource:' })
    assert.ok(emptyHtml.includes('data-command="importProject"'), 'an empty workspace must offer importing')
  })
})
