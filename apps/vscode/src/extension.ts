import * as vscode from 'vscode'
import {
  apply, allocate, emptyProject, fitCodepoints, parsePathList, toPaths, type Glyph, type Op, type Project,
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
import { FontTreeDropController, fromUri, isSvg, parseUriList, svgsIn, type SvgSource } from './drop.js'

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
  output.appendLine(`Iconotype ${context.extension.packageJSON.version} activated`)

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
      ? `$(warning) ${stale.length === 1 ? registry.label(stale[0]!) : `${stale.length} fonts`}: export pending`
      : `$(symbol-color) ${total} icon${total === 1 ? '' : 's'}`
    status.tooltip = stale.length
      ? `Font files are out of date for: ${stale.map((f) => registry.label(f)).join(', ')}\nClick to export.`
      : fonts.map((f) => `${registry.label(f)}: ${registry.selected(f).length} selected`).join('\n')
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
  const fontTreeDrop = new FontTreeDropController(
    registry, () => pickFont(), (font, sources) => addSvgSources(font, sources))
  context.subscriptions.push(
    decorations,
    vscode.window.registerFileDecorationProvider(decorations),
    vscode.window.createTreeView('iconotype.fonts', {
      treeDataProvider: fontTree, dragAndDropController: fontTreeDrop, canSelectMany: true,
    }),
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

  /**
   * The live font and glyph behind a tree node.
   *
   * A node carries the IconFont object it was BUILT with, and the registry replaces
   * that object wholesale on every reload — a save, a branch switch, an external
   * edit. The captured copy then fails the identity checks the rest of the extension
   * makes (`icons().find((i) => i.font === font)`) and, far worse, still carries the
   * project as it was: handing it to `mutate` writes an out-of-date document over
   * whatever is on disk now. So the node is treated as nothing but a uri and a glyph
   * id, and both are looked up again.
   *
   * Deliberately no `?? node.font` fallback: a font the registry no longer holds is a
   * font whose file is gone, and writing the stale copy back would resurrect it.
   */
  const resolveNode = (
    node?: { font?: IconFont; glyph?: { id: string; name?: string } },
  ): { font: IconFont; glyph: Glyph } | undefined => {
    if (!node?.font || !node.glyph) return undefined
    const font = registry.get(node.font.uri)
    if (!font) {
      vscode.window.showWarningMessage(`Iconotype: ${node.font.name} is no longer open in this workspace.`)
      return undefined
    }
    const glyph = font.project.sets.flatMap((s) => s.glyphs).find((g) => g.id === node.glyph!.id)
    if (!glyph) {
      vscode.window.showWarningMessage(
        `Iconotype: "${node.glyph.name ?? node.glyph.id}" is no longer in ${font.name}.`)
      return undefined
    }
    return { font, glyph }
  }

  /** Removes icons from a font, after asking. One write, however many there are. */
  const removeIcons = async (font: IconFont, ids: readonly string[]): Promise<boolean> => {
    const names = font.project.sets.flatMap((s) => s.glyphs).filter((g) => ids.includes(g.id)).map((g) => g.name)
    if (!names.length) return false
    const confirm = await vscode.window.showWarningMessage(
      names.length === 1
        ? `Remove "${names[0]}" from ${font.name}?`
        : `Remove ${names.length} icons from ${font.name}?`,
      {
        modal: true,
        detail: `${names.length === 1 ? 'Its codepoint stays' : 'Their codepoints stay'} reserved, so existing builds keep working.` +
          (names.length > 1 ? `\n\n${names.slice(0, 12).join(', ')}${names.length > 12 ? `, … ${names.length - 12} more` : ''}` : ''),
      },
      'Remove',
    )
    if (confirm !== 'Remove') return false
    // the dialog is modal, the file is not: a reload may have landed while it was up
    const current = registry.get(font.uri)
    if (!current) return false
    const still = current.project.sets.flatMap((s) => s.glyphs).filter((g) => ids.includes(g.id)).map((g) => g.id)
    if (!still.length) return false
    await mutate(registry, current, { t: 'glyph.remove', ids: still })
    return true
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

  const addSvgFiles = (font: IconFont, uris: vscode.Uri[], as?: string) =>
    addSvgSources(font, uris.map(fromUri), as)

  const addSvgSources = async (font: IconFont, sources: SvgSource[], as?: string) => {
    const set = font.project.sets[0]
    if (!set) return
    const { importSvg } = await heavy()
    /**
     * Keyed by name: the name IS the icon — it is the class, the codepoint key and the
     * glyph id. Two glyphs sharing one used to be added side by side and then fought
     * over all three, so a later file with the same name wins over an earlier one.
     */
    const imported = new Map<string, Glyph>()
    const warnings: string[] = []
    for (const { name, read } of sources) {
      try {
        const result = importSvg(await read(), name, { targetHeight: set.height })
        // an empty glyph is a blank cell with a codepoint: worse than not adding it
        if (!result.glyph.paths.some((d) => d.trim())) {
          warnings.push(`${name}: skipped, nothing drawable in it (${result.warnings.join('; ') || 'no geometry'})`)
          continue
        }
        // filling a named gap: the glyph has to answer to the name the code already
        // writes, whatever the file on disk happens to be called
        if (as) result.glyph.name = as
        imported.set(result.glyph.name, { ...result.glyph, id: `${font.uri.toString()}:${result.glyph.name}` })
        warnings.push(...result.warnings.map((w) => `${name}: ${w}`))
      } catch (e) {
        warnings.push((e as Error).message)
      }
    }
    if (!imported.size) {
      vscode.window.showErrorMessage(`Iconotype: nothing importable.\n${warnings.join('\n')}`)
      return
    }

    /**
     * An SVG named like an icon the font already has replaces that icon's artwork —
     * exactly what "Replace SVG…" does, so its codepoint, tags and inclusion stay and
     * nothing already built changes what `icon-home` renders to.
     */
    const existing = new Map(font.project.sets.flatMap((s) => s.glyphs).map((g) => [g.name, g]))
    const replaced: Op[] = []
    const glyphs: Glyph[] = []
    const refit: Glyph[] = []
    for (const glyph of imported.values()) {
      const old = existing.get(glyph.name)
      if (!old) { glyphs.push(glyph); continue }
      refit.push(glyph)
      replaced.push({
        t: 'glyph.patch',
        id: old.id,
        patch: { paths: glyph.paths, attrs: glyph.attrs, isMulticolor: glyph.isMulticolor, grid: glyph.grid },
      })
    }
    let project = font.project
    for (const op of replaced) project = apply(project, op).next
    if (glyphs.length) project = apply(project, { t: 'glyph.add', setId: set.id, glyphs }).next
    const { assignments, overflow } = allocate(
      project,
      glyphs.map((g) => ({ name: g.name, layers: g.isMulticolor ? g.paths.length : 1 })),
    )
    // replaced artwork may have more (or fewer) colour layers than codepoints
    for (const g of refit) {
      const fitted = fitCodepoints(
        apply(project, { t: 'codepoint.assign', assignments }).next, g.name, g.isMulticolor ? g.paths.length : 1)
      if (fitted !== undefined) assignments[g.name] = fitted
    }
    await mutate(registry, { ...font, project }, { t: 'codepoint.assign', assignments })

    for (const warning of warnings) output.appendLine(warning)
    if (overflow.length) vscode.window.showErrorMessage(`Iconotype: no codepoint available for ${overflow.join(', ')}`)
    const did = [
      glyphs.length ? `added ${glyphs.length}` : '',
      replaced.length ? `replaced ${replaced.length}` : '',
    ].filter(Boolean).join(' and ')
    vscode.window.showInformationMessage(
      `Iconotype: ${did} icon(s) in ${font.name}${warnings.length ? ` (${warnings.length} warning(s), see the output panel)` : ''}`)
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
      case 'drop': {
        if (!font) return
        const uris = (await svgsIn(parseUriList(message.uris.join('\n')))).map(fromUri)
        const files = message.files
          .filter((f) => isSvg(f.name))
          .map((f): SvgSource => ({ name: f.name, read: () => Promise.resolve(f.text) }))
        if (!uris.length && !files.length) {
          vscode.window.showWarningMessage('Iconotype: nothing to add — drop .svg files or a folder of them.')
          return
        }
        await addSvgSources(font, [...uris, ...files])
        return
      }
      case 'bulk': {
        if (!font || !message.ids.length) return
        if (message.action === 'remove') {
          if (await removeIcons(font, message.ids)) grid.clearPicked()
          return
        }
        await mutate(registry, font, { t: 'glyph.select', ids: message.ids, selected: message.action === 'include' })
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

  type IconNode = { font?: IconFont; glyph?: { id: string; name?: string } }
  /**
   * The rows a tree command acts on. With several rows selected VS Code passes the
   * clicked one AND all of them; the clicked one alone when it is not among them.
   */
  const nodesOf = (node?: IconNode, nodes?: readonly IconNode[]): IconNode[] =>
    nodes?.length && node && nodes.includes(node) ? [...nodes] : node ? [node] : []

  command('iconotype.removeIcon', async (node?: IconNode, nodes?: readonly IconNode[]) => {
    const targets = nodesOf(node, nodes).map((n) => resolveNode(n)).filter((t) => t !== undefined)
    const font = targets[0]?.font
    if (!font) return
    await removeIcons(font, targets.filter((t) => t.font === font).map((t) => t.glyph.id))
  })

  /**
   * Note the argument type: no `selected`. A node's copy of it is exactly as stale as
   * its font, so the flip is decided by what the file says NOW — otherwise a toggle
   * clicked after a reload flips from the wrong reading and appears to do nothing.
   *
   * Several rows flip together, all one way: the way the clicked row would flip.
   */
  command('iconotype.toggleIcon', async (node?: IconNode, nodes?: readonly IconNode[]) => {
    const targets = nodesOf(node, nodes).map((n) => resolveNode(n)).filter((t) => t !== undefined)
    const first = targets[0]
    if (!first) return
    await mutate(registry, first.font, {
      t: 'glyph.select',
      ids: targets.filter((t) => t.font === first.font).map((t) => t.glyph.id),
      selected: first.glyph.selected === false,
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
    const opening = resolveNode(node)
    if (!opening) return
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false, filters: { SVG: ['svg'] }, openLabel: `Replace "${opening.glyph.name}"`,
    })
    if (!picked?.length) return
    // resolved again after the dialog: picking a file is slow enough for a reload to land
    const target = resolveNode(node)
    if (!target) return
    const { font } = target
    const set = font.project.sets.find((s) => s.glyphs.some((g) => g.id === target.glyph.id))
    if (!set) return
    try {
      const { importSvg } = await heavy()
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(picked[0]!))
      const result = importSvg(text, picked[0]!.path.split('/').pop()!, { targetHeight: set.height })
      /**
       * Artwork only. The name, the tags and above all the CODEPOINT stay: replacing a
       * drawing must not change what `icon-home` renders to in anything already built.
       */
      const patch: Op = {
        t: 'glyph.patch',
        id: target.glyph.id,
        patch: {
          paths: result.glyph.paths,
          attrs: result.glyph.attrs,
          isMulticolor: result.glyph.isMulticolor,
          grid: result.glyph.grid,
        },
      }
      // the codepoint stays; a second colour layer needs a second one beside it
      const fitted = fitCodepoints(font.project, target.glyph.name,
        result.glyph.isMulticolor ? result.glyph.paths.length : 1)
      await mutate(registry, font, patch,
        ...(fitted === undefined ? [] : [{ t: 'codepoint.assign', assignments: { [target.glyph.name]: fitted } } as Op]))
      for (const warning of result.warnings) output.appendLine(`${target.glyph.name}: ${warning}`)
      vscode.window.showInformationMessage(`Iconotype: replaced the artwork for "${target.glyph.name}"`)
    } catch (e) {
      vscode.window.showErrorMessage(`Iconotype: replace failed — ${(e as Error).message}`)
    }
  })

  command('iconotype.flattenIcon', async (node?: { font?: IconFont; glyph?: { id: string; name: string } }) => {
    const found = resolveNode(node)
    if (!found) return
    const { glyph } = found
    const code = found.font.project.codepoints[glyph.name]
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
    // the confirmation was modal, not the file: resolve once more before writing
    const current = resolveNode(node)
    if (!current) return
    const now = current.font.project.codepoints[current.glyph.name]
    const live = now === undefined ? [] : Array.isArray(now) ? now : [now]
    let project = apply(current.font.project, {
      t: 'glyph.patch',
      id: current.glyph.id,
      patch: { isMulticolor: false, attrs: current.glyph.paths.map(() => ({})) },
    }).next
    if (live.length > 1) {
      project = apply(project, { t: 'codepoint.assign', assignments: { [current.glyph.name]: live[0]! } }).next
    }
    await registry.save(current.font, project)
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
      const guess = usage.likelyPrefix(font)
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
  /**
   * The last line of defence against an editor save that empties a font.
   *
   * Nothing the editor does on purpose should need this — but an editor that lost track
   * of its project once wrote an empty font over a real one, and the file is the only
   * copy. Removing every icon, or most of a sizeable font, in one save is asked about.
   */
  async function confirmLoss(font: IconFont, next: Project): Promise<boolean> {
    const count = (p: Project) => p.sets.reduce((n, s) => n + s.glyphs.length, 0)
    const before = count(font.project)
    const removed = before - count(next)
    if (before === 0 || removed <= 0) return true
    if (removed < before && (removed < 10 || removed * 2 <= before)) return true
    const choice = await vscode.window.showWarningMessage(
      `The editor is about to remove ${removed === before ? `all ${before}` : `${removed} of ${before}`} icons from ${font.name}.`,
      { modal: true, detail: 'Keep the file as it is if you did not mean to do this.' },
      'Remove them',
    )
    return choice === 'Remove them'
  }

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
    /**
     * The file text of this panel's last save. The watcher reloads the file after every
     * save and the re-parsed project is not always the identical object the editor
     * sent, so the editor would take its own edit for an outside change — and an
     * outside change starts a fresh history, which would empty undo after every edit.
     */
    let lastSaved: string | undefined

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
        if (!(await confirmLoss(current, message.project))) {
          // put the editor back on what the file actually holds
          lastSaved = undefined
          send()
          return
        }
        try {
          lastSaved = serializeIconFont(message.project)
          await registry.save(current, message.project)
        } catch (e) {
          lastSaved = undefined
          vscode.window.showErrorMessage(`Iconotype: could not save — ${(e as Error).message}`)
        }
      }
    })

    // keep the panel in step with edits made elsewhere (the grid, the tree, git)
    const subscription = registry.onDidChange(() => {
      const current = registry.get(font.uri)
      if (current && !current.error && lastSaved !== undefined && serializeIconFont(current.project) === lastSaved) return
      send()
    })
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
    exports, fontTree, heavyLoaded, fontTreeDrop,
  }
}

export function deactivate() {}
