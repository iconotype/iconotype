import * as vscode from 'vscode'
import {
  apply, allocate, emptyProject, parsePathList, toPaths, type Op, type Project,
} from '@iconotype/core-model'
import { serializeIconFont, ICONFONT_EXTENSION } from '@iconotype/core-io/iconfont-file'
import { heavy, heavyLoaded } from './lazy.js'
import { webviewCsp } from '@iconotype/build-config'
import { IconFontRegistry, type IconFont } from './registry.js'
import { GlyphIconCache } from './render.js'
import { describeResult, exportFont, resolveOutputConfig } from './export.js'
import { IconDiagnostics, IconQuickFixes } from './diagnostics.js'
import { autoExportMode, ExportState } from './stale.js'
import {
  IconCompletionProvider, IconDecorator, IconHoverProvider, referencePattern, SUPPORTED_LANGUAGES,
} from './language.js'
import { IconDefinitionProvider, IconReferenceProvider, IconRenameProvider } from './rename.js'
import {
  DEFAULT_EXCLUDE_DIRS, excludeGlobFor, pickUsageSite, usagePickItems, UsageIndex, UsageTreeProvider,
  type MissingIcon, type UsageSite,
} from './usage.js'
import { FontTreeProvider, IconDecorationProvider, IconGridViewProvider, type GridMessage } from './views.js'
import { describeMerge, mergeIntoFont, prepareImported, readImportable, runImportWizard } from './import.js'

/** Applies ops to a font's project and writes the file back. */
async function mutate(registry: IconFontRegistry, font: IconFont, ...ops: Op[]): Promise<Project> {
  let project = font.project
  for (const op of ops) project = apply(project, op).next
  await registry.save(font, project)
  return project
}

async function buildWebviewHtml(webview: vscode.Webview, root: vscode.Uri): Promise<string> {
  const nonce = [...Array(32)].map(() => Math.random().toString(36)[2]).join('')
  const dist = vscode.Uri.joinPath(root, 'dist', 'webview')
  let html = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dist, 'index.html')))

  html = html.replace(/(src|href)="\.\/([^"]+)"/g, (_m, attr: string, p: string) =>
    `${attr}="${webview.asWebviewUri(vscode.Uri.joinPath(dist, ...p.split('/')))}"`)
  html = html.replace(/<script /g, `<script nonce="${nonce}" `)
  html = html.replace(
    '<!--CSP-->',
    `<meta http-equiv="Content-Security-Policy" content="${webviewCsp(webview.cspSource, nonce, 'relaxed')}">\n` +
      `    <meta name="asset-base" content="${webview.asWebviewUri(dist)}">`,
  )
  return html
}

/**
 * Serves the webview Host adapter's filesystem and clipboard calls.
 *
 * The editor webview talks to the extension over postMessage rather than touching a
 * filesystem itself — see spikes/02 and packages/core-host. Without this the Host is
 * inert and every fs call in the editor hangs.
 */
function serveRpc(panel: vscode.WebviewPanel): vscode.Disposable {
  const uri = (p: string) => vscode.Uri.file(p)
  const handlers: Record<string, (...a: never[]) => Promise<unknown>> = {
    'fs.read': async (p: string) => [...(await vscode.workspace.fs.readFile(uri(p)))],
    'fs.write': async (p: string, data: string | number[]) =>
      void (await vscode.workspace.fs.writeFile(
        uri(p), typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data))),
    'fs.list': async (p: string) =>
      (await vscode.workspace.fs.readDirectory(uri(p))).map(([name, type]) => ({
        name, path: `${p}/${name}`, kind: type === vscode.FileType.Directory ? 'directory' : 'file',
      })),
    'fs.remove': async (p: string) => void (await vscode.workspace.fs.delete(uri(p), { recursive: true })),
    'fs.exists': async (p: string) => {
      try { await vscode.workspace.fs.stat(uri(p)); return true } catch { return false }
    },
    'clipboard.read': () => Promise.resolve(vscode.env.clipboard.readText()),
    'clipboard.write': async (t: string) => void (await vscode.env.clipboard.writeText(t)),
  } as Record<string, (...a: never[]) => Promise<unknown>>

  return panel.webview.onDidReceiveMessage(async (msg: { type?: string; id?: number; method?: string; args?: never[] }) => {
    if (msg?.type !== 'rpc' || !msg.method) return
    try {
      const handler = handlers[msg.method]
      if (!handler) throw new Error(`unknown rpc method ${msg.method}`)
      await panel.webview.postMessage({ type: 'rpc:result', id: msg.id, result: await handler(...(msg.args ?? [])) })
    } catch (e) {
      await panel.webview.postMessage({ type: 'rpc:result', id: msg.id, error: (e as Error).message })
    }
  })
}

export async function activate(context: vscode.ExtensionContext) {
  const registry = new IconFontRegistry()
  const icons = new GlyphIconCache(context)
  const usage = new UsageIndex(registry)
  const decorator = new IconDecorator(registry, icons)
  const diagnostics = new IconDiagnostics(registry)
  const output = vscode.window.createOutputChannel('Iconotype')
  const exports = new ExportState(registry, context.workspaceState)
  context.subscriptions.push(registry, icons, usage, decorator, diagnostics, output, exports)

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  status.command = 'iconotype.exportAll'
  context.subscriptions.push(status)

  const refreshStatus = () => {
    const fonts = registry.fonts
    // drives the welcome views: an empty workspace should offer importing, not scanning
    void vscode.commands.executeCommand('setContext', 'iconotype.hasFonts', fonts.length > 0)
    if (!fonts.length) { status.hide(); return }
    const total = fonts.reduce((n, f) => n + registry.selected(f).length, 0)
    const stale = exports.staleFonts

    // an edit changes nothing on disk until an export runs; say so where it is visible
    status.text = stale.length
      ? `$(warning) ${stale.length === 1 ? stale[0]!.name : `${stale.length} fonts`}: export pending`
      : `$(symbol-color) ${total} icon${total === 1 ? '' : 's'}`
    status.tooltip = stale.length
      ? `Font files are out of date for: ${stale.map((f) => f.name).join(', ')}\nClick to export.`
      : fonts.map((f) => `${f.name}: ${registry.selected(f).length} selected`).join('\n')
    status.backgroundColor = stale.length
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined
    status.command = stale.length ? 'iconotype.exportPending' : 'iconotype.exportAll'
    status.show()
  }

  // ── views ──────────────────────────────────────────────────────────────────────
  const fontTree = new FontTreeProvider(registry, icons, exports)
  const usageTree = new UsageTreeProvider(usage, registry)
  const grid = new IconGridViewProvider(registry, (message) => void onGridMessage(message), exports)

  const decorations = new IconDecorationProvider(registry)
  context.subscriptions.push(
    decorations,
    vscode.window.registerFileDecorationProvider(decorations),
    vscode.window.registerTreeDataProvider('iconotype.fonts', fontTree),
    vscode.window.registerTreeDataProvider('iconotype.usage', usageTree),
    vscode.window.registerWebviewViewProvider(IconGridViewProvider.viewType, grid),
  )

  // ── helpers ────────────────────────────────────────────────────────────────────
  const pickFont = async (uri?: string | vscode.Uri): Promise<IconFont | undefined> => {
    if (uri) {
      const found = registry.get(typeof uri === 'string' ? vscode.Uri.parse(uri) : uri)
      if (found) return found
    }
    // a font that failed to parse is never the one the user meant
    const fonts = registry.fonts.filter((f) => !f.error)
    if (fonts.length === 0) {
      vscode.window.showWarningMessage('No icon fonts in this workspace. Run "Iconotype: New Icon Font" to create one.')
      return undefined
    }
    if (fonts.length === 1) return fonts[0]
    const choice = await vscode.window.showQuickPick(
      fonts.map((f) => ({ label: f.name, description: vscode.workspace.asRelativePath(f.uri), font: f })),
      { placeHolder: 'Which icon font?' },
    )
    return choice?.font
  }

  const runExport = async (font: IconFont) => {
    try {
      const result = await exportFont(font, registry)
      if (!result.skipped) await exports.record(font)
      output.appendLine(describeResult(result))
      if (result.skipped) vscode.window.showWarningMessage(describeResult(result))
      else vscode.window.setStatusBarMessage(`$(check) ${describeResult(result)}`, 4000)
    } catch (e) {
      output.appendLine(`${font.name}: export failed — ${(e as Error).message}`)
      vscode.window.showErrorMessage(`Iconotype: export failed — ${(e as Error).message}`)
    }
  }

  const addSvgFiles = async (font: IconFont, uris: vscode.Uri[], as?: string) => {
    const set = font.project.sets[0]
    if (!set) return
    const { importSvg } = await heavy()
    const glyphs = []
    const warnings: string[] = []
    for (const uri of uris) {
      const name = uri.path.split('/').pop()!
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
        const result = importSvg(text, name, { targetHeight: set.height })
        // filling a named gap: the glyph has to answer to the name the code already
        // writes, whatever the file on disk happens to be called
        if (as) result.glyph.name = as
        glyphs.push({ ...result.glyph, id: `${font.uri.toString()}:${result.glyph.name}` })
        warnings.push(...result.warnings.map((w) => `${name}: ${w}`))
      } catch (e) {
        warnings.push((e as Error).message)
      }
    }
    if (!glyphs.length) {
      vscode.window.showErrorMessage(`Iconotype: nothing importable.\n${warnings.join('\n')}`)
      return
    }
    const withGlyphs = apply(font.project, { t: 'glyph.add', setId: set.id, glyphs }).next
    const { assignments, overflow } = allocate(
      withGlyphs,
      glyphs.map((g) => ({ name: g.name, layers: g.isMulticolor ? g.paths.length : 1 })),
    )
    await mutate(registry, { ...font, project: withGlyphs }, { t: 'codepoint.assign', assignments })

    for (const warning of warnings) output.appendLine(warning)
    if (overflow.length) vscode.window.showErrorMessage(`Iconotype: no codepoint available for ${overflow.join(', ')}`)
    vscode.window.showInformationMessage(
      `Iconotype: added ${glyphs.length} icon(s) to ${font.name}${warnings.length ? ` (${warnings.length} warning(s), see the output panel)` : ''}`)
  }

  /**
   * The four values from the grid's settings panel.
   *
   * Prefix and family live in `preferences.font`; the two paths live in `output`,
   * which is what the CLI and CI read too — so changing them here changes every build,
   * not just this editor's.
   */
  async function applySetting(font: IconFont, key: string, value: string): Promise<void> {
    if (key === 'prefix' || key === 'family') {
      if (!value) return
      await mutate(registry, font, { t: 'prefs.patch', patch: { font: { [key]: value } } })
      return
    }
    if (key === 'usagePrefix') {
      // blank clears it: the class prefix is then the only thing looked for
      await mutate(registry, font, {
        t: 'prefs.patch',
        patch: { font: { usagePrefixes: value ? value.split(',').map((p) => p.trim()).filter(Boolean) : [] } },
      })
      return
    }
    const output = resolveOutputConfig(font)
    if (key === 'fontsDir') {
      if (!value) return
      await mutate(registry, font, {
        t: 'output.patch',
        // comma-separated: the same font written to more than one place
        patch: {
          fonts: {
            ...(output.fonts ?? { formats: ['woff2', 'woff', 'ttf'] }),
            dir: toPaths(parsePathList(value).map((dir) => dir.replace(/\/+$/, ''))),
          },
        },
      })
      return
    }
    if (key === 'stylePath') {
      if (!value) return
      const existing = output.styles?.[0]
      const paths = parsePathList(value)
      if (!paths.length) return
      // the kind follows the FIRST path's extension; every copy is the same file
      const kind = existing?.kind
        ?? (paths[0]!.endsWith('.scss') ? 'scss-variables' : paths[0]!.endsWith('.less') ? 'less' : 'css')
      await mutate(registry, font, {
        t: 'output.patch',
        patch: { styles: [{ kind, path: toPaths(paths) }, ...(output.styles ?? []).slice(1)] },
      })
    }
  }

  async function onGridMessage(message: GridMessage) {
    const font = grid.activeFont
    switch (message.type) {
      case 'export': if (font) await runExport(font); return
      case 'create': await vscode.commands.executeCommand('iconotype.newFont'); return
      case 'importProject': await vscode.commands.executeCommand('iconotype.importProject'); return
      case 'import': if (font) await vscode.commands.executeCommand('iconotype.addIcons', font.uri); return
      case 'importIcons': if (font) await vscode.commands.executeCommand('iconotype.importIcons', font.uri); return
      case 'toggle': {
        if (!font) return
        const glyph = font.project.sets.flatMap((s) => s.glyphs).find((g) => g.id === message.id)
        if (!glyph) return
        await mutate(registry, font, { t: 'glyph.select', ids: [glyph.id], selected: glyph.selected === false })
        return
      }
      case 'open': if (font) await vscode.commands.executeCommand('iconotype.open', font.uri, message.id); return
      case 'settings': {
        // the collapsed panel in the grid is the quick path; this is the full file
        if (font) await vscode.window.showTextDocument(font.uri)
        return
      }
      case 'setting': {
        if (!font) return
        await applySetting(font, message.key, message.value.trim())
        return
      }
      case 'action': {
        if (!font) return
        const glyph = font.project.sets.flatMap((s) => s.glyphs).find((g) => g.id === message.id)
        if (!glyph) return
        switch (message.action) {
          case 'open': await vscode.commands.executeCommand('iconotype.open', font.uri, glyph.id); return
          case 'usage': await vscode.commands.executeCommand('iconotype.showUsage', font.uri, glyph.name); return
          case 'replace': await vscode.commands.executeCommand('iconotype.replaceIcon', { font, glyph }); return
          case 'remove': await vscode.commands.executeCommand('iconotype.removeIcon', { font, glyph }); return
          case 'toggle':
            await mutate(registry, font, { t: 'glyph.select', ids: [glyph.id], selected: glyph.selected === false })
            return
          case 'copy': {
            await vscode.env.clipboard.writeText(`${font.prefix}${glyph.name}`)
            vscode.window.setStatusBarMessage(`$(check) copied ${font.prefix}${glyph.name}`, 2000)
            return
          }
        }
        return
      }
      case 'selectAll':
      case 'selectNone': {
        if (!font) return
        const ids = font.project.sets.flatMap((s) => s.glyphs).map((g) => g.id)
        await mutate(registry, font, { t: 'glyph.select', ids, selected: message.type === 'selectAll' })
        return
      }
    }
  }

  // ── commands ───────────────────────────────────────────────────────────────────
  const command = (name: string, handler: (...args: never[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, handler as never))

  command('iconotype.export', async (uri?: vscode.Uri) => {
    const font = await pickFont(uri)
    if (font) await runExport(font)
  })

  command('iconotype.exportPending', async () => {
    const stale = exports.staleFonts
    if (!stale.length) {
      vscode.window.setStatusBarMessage('$(check) Iconotype: everything is up to date', 3000)
      return
    }
    for (const font of stale) await runExport(font)
  })

  command('iconotype.exportAll', async () => {
    for (const font of registry.fonts) await runExport(font)
    if (registry.fonts.length > 1) vscode.window.showInformationMessage(`Iconotype: exported ${registry.fonts.length} fonts`)
  })

  command('iconotype.addIcons', async (uri?: vscode.Uri) => {
    const font = await pickFont(uri)
    if (!font) return
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { SVG: ['svg'] },
      openLabel: 'Add to icon font',
    })
    if (files?.length) await addSvgFiles(font, files)
  })

  command('iconotype.removeIcon', async (node?: { font?: IconFont; glyph?: { id: string; name: string } }) => {
    if (!node?.font || !node.glyph) return
    const confirm = await vscode.window.showWarningMessage(
      `Remove "${node.glyph.name}" from ${node.font.name}?`,
      { modal: true, detail: 'Its codepoint stays reserved, so existing builds keep working.' },
      'Remove',
    )
    if (confirm !== 'Remove') return
    await mutate(registry, node.font, { t: 'glyph.remove', ids: [node.glyph.id] })
  })

  command('iconotype.toggleIcon', async (node?: { font?: IconFont; glyph?: { id: string; selected?: boolean } }) => {
    if (!node?.font || !node.glyph) return
    await mutate(registry, node.font, {
      t: 'glyph.select', ids: [node.glyph.id], selected: node.glyph.selected === false,
    })
  })

  command('iconotype.revealIcon', (uriString?: string, glyphId?: string) => {
    const font = uriString ? registry.get(vscode.Uri.parse(uriString)) : undefined
    if (font) grid.show(font, glyphId)
  })

  /**
   * Reached two ways with two different first arguments: the grid passes `(uri, name)`,
   * while a tree row's menu passes the node itself and nothing else. Before this told
   * them apart, the tree entry looked live and did nothing at all — `name` arrived
   * undefined and the command returned without a word.
   */
  command('iconotype.showUsage', async (
    target?: vscode.Uri | { font?: IconFont; glyph?: { name: string } }, glyphName?: string,
  ) => {
    const node = target && !(target instanceof vscode.Uri) ? target : undefined
    /*
     * Re-resolve through the registry rather than trusting the object on the node. A
     * tree row, and the usage index behind it, both hold whichever IconFont was current
     * when they were built, and a reload — a save, a branch switch — replaces it. The
     * stale copy then fails every identity check downstream and the command gives up
     * without a word, which is precisely how this looked from the outside.
     */
    const font = node?.font
      ? registry.get(node.font.uri)
      : await pickFont(target as vscode.Uri | undefined)
    const name = glyphName ?? node?.glyph?.name
    if (!font || !name) return
    const icon = registry.icons().find((i) => i.font === font && i.glyph.name === name)
    if (!icon) return
    if (!usage.for(icon)) {
      await vscode.window.withProgress(
        { location: { viewId: 'iconotype.usage' }, title: 'Scanning for icon usage' },
        () => usage.scan(),
      )
    }
    const sites = usage.for(icon)?.sites ?? []
    if (!sites.length) {
      vscode.window.showInformationMessage(`Iconotype: "${font.prefix}${name}" is not referenced anywhere.`)
      return
    }
    // a site is written with whichever prefix that file uses, so the span is per-site
    const rangeOf = (s: UsageSite) => new vscode.Range(
      s.line, s.column, s.line, s.column + (s.prefix || font.prefix).length + name.length)

    // one hit goes straight there; several are worth walking through
    const site = sites.length === 1 ? sites[0]! : await pickUsageSite(sites, {
      title: `${sites.length} references to ${font.prefix}${name}`,
      rangeOf,
    })
    if (!site) return
    await vscode.window.showTextDocument(site.uri, { selection: rangeOf(site), preview: false })
  })

  command('iconotype.replaceIcon', async (node?: { font?: IconFont; glyph?: { id: string; name: string } }) => {
    if (!node?.font || !node.glyph) return
    const font = registry.get(node.font.uri) ?? node.font
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false, filters: { SVG: ['svg'] }, openLabel: `Replace "${node.glyph.name}"`,
    })
    if (!picked?.length) return
    const set = font.project.sets.find((s) => s.glyphs.some((g) => g.id === node.glyph!.id))
    if (!set) return
    try {
      const { importSvg } = await heavy()
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(picked[0]!))
      const result = importSvg(text, picked[0]!.path.split('/').pop()!, { targetHeight: set.height })
      /**
       * Artwork only. The name, the tags and above all the CODEPOINT stay: replacing a
       * drawing must not change what `icon-home` renders to in anything already built.
       */
      await mutate(registry, font, {
        t: 'glyph.patch',
        id: node.glyph.id,
        patch: {
          paths: result.glyph.paths,
          attrs: result.glyph.attrs,
          isMulticolor: result.glyph.isMulticolor,
          grid: result.glyph.grid,
        },
      })
      for (const warning of result.warnings) output.appendLine(`${node.glyph.name}: ${warning}`)
      vscode.window.showInformationMessage(`Iconotype: replaced the artwork for "${node.glyph.name}"`)
    } catch (e) {
      vscode.window.showErrorMessage(`Iconotype: replace failed — ${(e as Error).message}`)
    }
  })

  command('iconotype.flattenIcon', async (node?: { font?: IconFont; glyph?: { id: string; name: string } }) => {
    if (!node?.font || !node.glyph) return
    const font = registry.get(node.font.uri) ?? node.font
    const glyph = font.project.sets.flatMap((s) => s.glyphs).find((g) => g.id === node.glyph!.id)
    if (!glyph) return
    const code = font.project.codepoints[glyph.name]
    const codes = code === undefined ? [] : Array.isArray(code) ? code : [code]
    const confirm = await vscode.window.showWarningMessage(
      `Flatten "${glyph.name}" to a single colour?`,
      {
        modal: true,
        detail: codes.length > 1
          ? `Its ${glyph.paths.length} layers become one shape. U+${codes[0]!.toString(16)} is kept; ${codes.slice(1).map((c) => 'U+' + c.toString(16)).join(', ')} are released.`
          : 'Its fills are dropped, so it paints in whatever colour the CSS says.',
      },
      'Flatten',
    )
    if (confirm !== 'Flatten') return
    let project = apply(font.project, {
      t: 'glyph.patch', id: glyph.id, patch: { isMulticolor: false, attrs: glyph.paths.map(() => ({})) },
    }).next
    if (codes.length > 1) {
      project = apply(project, { t: 'codepoint.assign', assignments: { [glyph.name]: codes[0]! } }).next
    }
    await registry.save(font, project)
  })

  command('iconotype.insertIcon', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const all = registry.icons().filter((i) => i.selected)
    const choice = await vscode.window.showQuickPick(
      all.map((icon) => ({
        label: `${icon.font.prefix}${icon.glyph.name}`,
        description: icon.codepoints.map((c) => 'U+' + c.toString(16)).join(' '),
        detail: icon.glyph.tags.join(', '),
        icon,
      })),
      { placeHolder: 'Insert an icon reference', matchOnDetail: true },
    )
    if (!choice) return
    await editor.edit((edit) => {
      for (const selection of editor.selections) edit.replace(selection, choice.label)
    })
  })

  command('iconotype.scanUsage', async () => {
    await vscode.window.withProgress(
      { location: { viewId: 'iconotype.usage' }, title: 'Scanning for icon usage' },
      () => usage.scan(),
    )
    const all = usage.all()
    const used = all.filter((u) => u.sites.length)
    const references = used.reduce((n, u) => n + u.sites.length, 0)

    // a font whose prefix does not match what the code writes looks entirely unused,
    // which is a confusing thing to be told; say what the code actually uses instead
    for (const font of registry.fonts) {
      const mine = all.filter((u) => u.icon.font === font)
      if (!mine.length || mine.some((u) => u.sites.length)) continue
      const guess = usage.likelyPrefix(font.name)
      if (!guess) continue
      const choice = await vscode.window.showWarningMessage(
        `Iconotype: nothing references "${font.prefix}…", but "${guess.prefix}" appears ${guess.count}× with your icon names.`,
        'Also look for it', 'Rename the class prefix', 'Leave it',
      )
      /**
       * Two different fixes, and the first is usually the right one: a build step that
       * rewrites references (a webpack alias, say) means the code legitimately writes a
       * prefix the stylesheet never declares. Changing the class prefix instead would
       * rewrite the generated CSS and break everything already using it.
       */
      if (choice === 'Also look for it') {
        const existing = font.project.preferences.font.usagePrefixes ?? []
        await mutate(registry, font, {
          t: 'prefs.patch',
          patch: { font: { usagePrefixes: [...new Set([guess.prefix, ...existing])] } },
        })
        await usage.scan()
      } else if (choice === 'Rename the class prefix') {
        await mutate(registry, font, { t: 'prefs.patch', patch: { font: { prefix: guess.prefix } } })
        await usage.scan()
      }
      return
    }

    const report = usage.report
    output.appendLine(`usage scan: ${report.files} file(s) read${report.truncated ? ' (LIMIT HIT — results are partial)' : ''}`)
    // a truncated scan reporting "unused" is worse than no answer at all
    if (report.truncated) {
      vscode.window.showWarningMessage(
        `Iconotype: stopped after ${report.files} files, so "unused" is not trustworthy. Narrow it with iconotype.usage.include / .exclude.`,
      )
      return
    }
    vscode.window.showInformationMessage(
      used.length
        ? `Iconotype: ${used.length}/${all.length} icon(s) referenced, ${references} time(s) across ${report.files} file(s); ${all.length - used.length} unused`
        : `Iconotype: none of the ${all.length} icon(s) are referenced in ${report.files} file(s)`,
    )
  })

  command('iconotype.importProject', async (uri?: vscode.Uri) => {
    try {
      const result = await runImportWizard(registry, uri)
      if (!result) return
      for (const warning of result.warnings) output.appendLine(warning)

      const font = registry.get(result.uri)
      if (font) grid.show(font)

      const relative = vscode.workspace.asRelativePath(result.uri)
      const choice = await vscode.window.showInformationMessage(
        `Iconotype: imported ${result.iconCount} icon(s) into ${relative}` +
          (result.warnings.length ? ` (${result.warnings.length} warning(s), see the output panel)` : ''),
        'Export now', 'Open file',
      )
      if (choice === 'Export now' && font) await runExport(font)
      if (choice === 'Open file') await vscode.window.showTextDocument(result.uri)
    } catch (e) {
      output.appendLine(`import failed — ${(e as Error).message}`)
      vscode.window.showErrorMessage(`Iconotype: import failed — ${(e as Error).message}`)
    }
  })

  command('iconotype.importIcons', async (uri?: vscode.Uri) => {
    const font = await pickFont(uri)
    if (!font) return
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: `Add to ${font.name}`,
      filters: { 'Icon project': ['json', 'zip'] },
    })
    if (!picked?.length) return
    try {
      const source = await readImportable(picked[0]!, font.project.sets[0]?.height ?? 1024)
      const result = await mergeIntoFont(registry, font, source)
      for (const warning of result.warnings) output.appendLine(warning)
      if (!result.added.length) {
        vscode.window.showWarningMessage(`Iconotype: nothing new to add — ${font.name} already has all ${result.skipped.length} icon(s)`)
        return
      }
      vscode.window.showInformationMessage(describeMerge(font, result))
    } catch (e) {
      output.appendLine(`import failed — ${(e as Error).message}`)
      vscode.window.showErrorMessage(`Iconotype: import failed — ${(e as Error).message}`)
    }
  })

  command('iconotype.newFont', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) {
      vscode.window.showErrorMessage('Iconotype: open a folder first')
      return
    }
    const name = await vscode.window.showInputBox({
      prompt: 'Name for the icon font (also the class prefix root)',
      value: 'app',
      validateInput: (v) => (/^[a-z][a-z0-9-]*$/i.test(v) ? undefined : 'letters, digits and dashes only'),
    })
    if (!name) return

    const project = emptyProject(name, name)
    project.preferences.font.family = name
    project.preferences.font.prefix = `${name}-`
    project.output = resolveOutputConfig({ uri: folder.uri, name, prefix: `${name}-`, project } as IconFont)

    const target = vscode.Uri.joinPath(folder.uri, `${name}${ICONFONT_EXTENSION}`)
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(serializeIconFont(project)))
    await registry.load(target)
    await vscode.window.showTextDocument(target)
    vscode.window.showInformationMessage(`Iconotype: created ${name}${ICONFONT_EXTENSION}. Add SVGs with "Iconotype: Add Icons".`)
  })

  /**
   * One editor per font, not one per click.
   *
   * Every panel holds a full copy of the app with `retainContextWhenHidden`, so the
   * old behaviour turned a morning of clicking icons into a row of identical tabs, each
   * costing a few megabytes and each with its own unsaved-edit state — and the one you
   * were last working in was never the one that came forward. Opening a font that is
   * already open now reveals that panel and re-points it at the icon you asked for.
   */
  const editors = new Map<string, {
    panel: vscode.WebviewPanel
    focus: (glyph?: string, library?: boolean, query?: string) => void
  }>()

  command('iconotype.open', async (uri?: vscode.Uri, focus?: string, library?: boolean, query?: string) => {
    const font = await pickFont(uri)
    if (!font) return undefined

    const key = font.uri.toString()
    const open = editors.get(key)
    if (open) {
      open.panel.reveal(open.panel.viewColumn ?? vscode.ViewColumn.Active)
      open.focus(focus, library, query)
      return open.panel
    }

    const panel = vscode.window.createWebviewPanel(
      'iconotype.editor', `${font.name} — Iconotype`, vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
      },
    )
    context.subscriptions.push(serveRpc(panel))
    panel.webview.html = await buildWebviewHtml(panel.webview, context.extensionUri)

    /**
     * Proves a save came from a panel that was actually handed this project.
     *
     * The editor boots holding a placeholder project and its save effect runs on
     * mount, so before this existed, opening the editor wrote an EMPTY font over the
     * file — silently destroying an imported project. The webview only learns the
     * token from a `project` message, so a save without it cannot be genuine.
     */
    const token = [...Array(16)].map(() => Math.random().toString(36)[2]).join('')
    let sentOnce = false

    const send = (focusGlyph?: string, openLibrary?: boolean, libraryQuery?: string) => {
      const current = registry.get(font.uri)
      if (current && !current.error) {
        sentOnce = true
        void panel.webview.postMessage({
          type: 'project', project: current.project, name: current.name, token,
          focus: focusGlyph, library: openLibrary, libraryQuery,
        })
      }
    }

    panel.webview.onDidReceiveMessage(async (message: { type?: string; project?: Project; token?: string }) => {
      // the editor asks for its project once it has booted
      if (message?.type === 'ready') { send(focus, library, query); return }
      // and writes every edit straight back to the .iconotype.json
      if (message?.type === 'save' && message.project) {
        if (!sentOnce || message.token !== token) {
          output.appendLine(`${font.name}: ignored a save from an editor that was never given this project`)
          return
        }
        const current = registry.get(font.uri) ?? font
        try {
          await registry.save(current, message.project)
        } catch (e) {
          vscode.window.showErrorMessage(`Iconotype: could not save — ${(e as Error).message}`)
        }
      }
    })

    // keep the panel in step with edits made elsewhere (the grid, the tree, git)
    const subscription = registry.onDidChange(() => send())
    editors.set(key, { panel, focus: send })
    panel.onDidDispose(() => {
      subscription.dispose()
      editors.delete(key)
    })
    return panel
  })

  /**
   * The icon library, from the command palette.
   *
   * It rides on `iconotype.open` rather than opening its own panel: the library adds
   * glyphs to a project, so it needs a project loaded and a panel that can save one.
   * The flag travels with the `project` message instead of as a second postMessage,
   * because the webview is not listening yet when the panel is created.
   */
  command('iconotype.findIcons', async (uri?: vscode.Uri, query?: string) => {
    await vscode.commands.executeCommand('iconotype.open', uri, undefined, true, query)
  })

  /**
   * The two ways out of a missing icon: find one, or bring your own.
   *
   * Both name the new glyph after the reference that is already written, so the code
   * that was broken resolves without being touched — which is the whole point. Renaming
   * every call site instead is the other valid fix, and rename already does that.
   */
  command('iconotype.addMissingFromLibrary', async (node?: { item?: MissingIcon }) => {
    const missing = node?.item
    if (!missing) return
    const font = registry.get(missing.font.uri) ?? missing.font
    await vscode.commands.executeCommand('iconotype.findIcons', font.uri, missing.name)
  })

  command('iconotype.addMissingFromSvg', async (node?: { item?: MissingIcon }) => {
    const missing = node?.item
    if (!missing) return
    const font = registry.get(missing.font.uri)
    if (!font) return
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { SVG: ['svg'] },
      openLabel: `Add as "${missing.name}"`,
      title: `Artwork for ${missing.prefix}${missing.name}`,
    })
    if (!files?.length) return
    await addSvgFiles(font, files, missing.name)
    await usage.scan()
  })

  // ── editor integration ─────────────────────────────────────────────────────────
  // no scheme filter: an untitled buffer is still worth completing in
  const selector = SUPPORTED_LANGUAGES.map((language) => ({ language }))
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, new IconCompletionProvider(registry), '-', '"', "'"),
    vscode.languages.registerHoverProvider(selector, new IconHoverProvider(registry)),
    vscode.languages.registerRenameProvider(selector, new IconRenameProvider(registry, usage)),
    vscode.languages.registerDefinitionProvider(selector, new IconDefinitionProvider(registry)),
    vscode.languages.registerReferenceProvider(selector, new IconReferenceProvider(registry, usage)),
    vscode.languages.registerCodeActionsProvider(selector, new IconQuickFixes(), {
      providedCodeActionKinds: IconQuickFixes.kinds,
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      decorator.schedule(editor)
      if (editor) diagnostics.schedule(editor.document)
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== vscode.window.activeTextEditor?.document) return
      decorator.schedule(vscode.window.activeTextEditor)
      diagnostics.schedule(event.document)
    }),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.clear(document.uri)),
    registry.onDidChange(() => {
      refreshStatus()
      fontTree.refresh()
      void decorator.render(vscode.window.activeTextEditor)
      // a renamed or removed icon changes what is valid in every open file
      for (const editor of vscode.window.visibleTextEditors) diagnostics.refresh(editor.document)
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      // keep the usage index current without rescanning the whole workspace
      usage.updateFile(document.uri, document.getText())
      if (!document.uri.path.endsWith(ICONFONT_EXTENSION)) return
      if (autoExportMode(document.uri) !== 'onSave') return
      const font = registry.get(document.uri)
      if (font) await runExport(font)
    }),
    exports.onDidChange(() => {
      refreshStatus()
      fontTree.refresh()
      grid.refresh()
    }),
  )

  /**
   * `autoExport: onChange` exports on every edit, not just on save.
   *
   * Debounced, because a click in the grid writes the project file and the watcher
   * then reports it — without the delay a burst of toggles would kick off a font build
   * each. Stale fonts only: an export that would write identical bytes is not worth
   * the build.
   */
  let autoTimer: ReturnType<typeof setTimeout> | undefined
  context.subscriptions.push(
    exports.onDidChange(() => {
      if (autoExportMode() !== 'onChange') return
      if (autoTimer) clearTimeout(autoTimer)
      autoTimer = setTimeout(async () => {
        for (const font of exports.staleFonts) await runExport(font)
      }, 800)
    }),
    { dispose: () => { if (autoTimer) clearTimeout(autoTimer) } },
  )

  await registry.initialize()
  refreshStatus()

  /**
   * Nothing below blocks activation.
   *
   * Staleness stats the output files and decoration renders glyph SVGs; both are
   * useful within a moment of the window opening and neither is worth holding it up.
   */
  void exports.refresh()
  void decorator.render(vscode.window.activeTextEditor)
  if (vscode.window.activeTextEditor) diagnostics.refresh(vscode.window.activeTextEditor.document)
  if (vscode.workspace.getConfiguration('iconotype').get<boolean>('usage.scanOnStartup', false)) {
    void usage.scan()
  }

  // exported for the integration tests
  return {
    registry, usage, decorator, diagnostics, exportFont: runExport, addSvgFiles, grid,
    // the import wizard's own steps are dialogs, so the tests drive these directly
    readImportable, mergeIntoFont, prepareImported, usageTree,
    usageInternals: { DEFAULT_EXCLUDE_DIRS, excludeGlobFor, usagePickItems, referencePattern },
    exports, fontTree, heavyLoaded,
  }
}

export function deactivate() {}
