import * as vscode from 'vscode'
import type { Glyph } from '@iconotype/core-model'
import { GlyphIconCache, glyphDataUri } from './render.js'
import type { IconFont, IconFontRegistry } from './registry.js'

/**
 * The sidebar.
 *
 * Two views: a tree of the workspace's fonts (for structure and commands) and a grid
 * webview of one font's icons (for actually looking at them). The grid is where
 * selection for export happens, because deciding what ships is a visual judgement.
 */

/**
 * A uri whose only job is to carry decoration state for one row.
 *
 * VSCode colours a tree row through a `FileDecorationProvider` keyed by `resourceUri`,
 * so the state has to be encoded in a uri rather than set on the item.
 */
export const glyphDecorationUri = (font: IconFont, glyph: Glyph): vscode.Uri =>
  vscode.Uri.from({
    scheme: 'iconotype-icon',
    path: `/${font.name}/${glyph.name}`,
    query: glyph.selected === false ? 'excluded' : 'included',
  })

/** Colours excluded icons, everywhere a tree row carries a glyph uri. */
export class IconDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  #emitter = new vscode.EventEmitter<undefined>()
  readonly onDidChangeFileDecorations = this.#emitter.event
  #subscription: vscode.Disposable

  constructor(registry: IconFontRegistry) {
    this.#subscription = registry.onDidChange(() => this.#emitter.fire(undefined))
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'iconotype-icon') return undefined
    if (uri.query !== 'excluded') return undefined
    return {
      badge: '⊘',
      color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
      tooltip: 'Excluded from the built font',
    }
  }

  dispose(): void { this.#subscription.dispose(); this.#emitter.dispose() }
}

type FontNode =
  | { kind: 'font'; font: IconFont }
  | { kind: 'icon'; font: IconFont; glyph: Glyph }
  | { kind: 'message'; text: string; font: IconFont }

export class FontTreeProvider implements vscode.TreeDataProvider<FontNode> {
  #emitter = new vscode.EventEmitter<FontNode | undefined>()
  readonly onDidChangeTreeData = this.#emitter.event

  constructor(
    private registry: IconFontRegistry,
    private icons: GlyphIconCache,
    private stale?: { isStale(font: IconFont): boolean },
  ) {
    registry.onDidChange(() => this.refresh())
  }

  refresh(): void { this.#emitter.fire(undefined) }

  async getTreeItem(node: FontNode): Promise<vscode.TreeItem> {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None)
      item.iconPath = new vscode.ThemeIcon('error')
      return item
    }
    if (node.kind === 'font') {
      const count = node.font.project.sets.reduce((n, s) => n + s.glyphs.length, 0)
      const selected = this.registry.selected(node.font).length
      const pending = !node.font.error && (this.stale?.isStale(node.font) ?? false)
      const item = new vscode.TreeItem(node.font.name, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = node.font.error
        ? 'failed to load'
        : `${selected === count ? `${count} icons` : `${selected}/${count} icons`}${pending ? ' · export pending' : ''}`
      item.iconPath = new vscode.ThemeIcon(
        node.font.error ? 'warning' : pending ? 'cloud-upload' : 'symbol-color',
        pending ? new vscode.ThemeColor('list.warningForeground') : undefined,
      )
      item.resourceUri = node.font.uri
      item.contextValue = 'iconotype.font'
      item.tooltip = new vscode.MarkdownString(
        `**${node.font.name}** — prefix \`${node.font.prefix}\`\n\n${vscode.workspace.asRelativePath(node.font.uri)}`)
      return item
    }

    const cp = node.font.project.codepoints[node.glyph.name]
    const codes = cp === undefined ? [] : Array.isArray(cp) ? cp : [cp]
    const excluded = node.glyph.selected === false
    const item = new vscode.TreeItem(node.glyph.name, vscode.TreeItemCollapsibleState.None)
    item.description = `${codes.map((c) => 'U+' + c.toString(16)).join(' ')}${excluded ? ' · excluded' : ''}`
    item.iconPath = await this.icons.iconPath(node.font, node.glyph)
    /**
     * Whether an icon ships is the one thing this tree is for, so it is coloured on
     * the row itself. The inline include/exclude button only appears on hover, which
     * made the state invisible until you went looking for it.
     */
    item.resourceUri = glyphDecorationUri(node.font, node.glyph)
    item.contextValue = excluded ? 'iconotype.icon.excluded' : 'iconotype.icon'
    item.command = {
      command: 'iconotype.revealIcon',
      title: 'Show icon',
      arguments: [node.font.uri.toString(), node.glyph.id],
    }
    return item
  }

  getChildren(node?: FontNode): FontNode[] {
    if (!node) return this.registry.fonts.map((font) => ({ kind: 'font', font }))
    if (node.kind !== 'font') return []
    if (node.font.error) return [{ kind: 'message', text: node.font.error, font: node.font }]
    return node.font.project.sets.flatMap((set) =>
      set.glyphs.map((glyph) => ({ kind: 'icon' as const, font: node.font, glyph })))
  }
}

/**
 * The icon grid, as a sidebar webview.
 *
 * Hand-written HTML rather than the Svelte app: it is a small, self-contained surface,
 * and keeping it independent means the sidebar keeps working regardless of what the
 * full editor webview is doing. Same CSP rules as everywhere else — nonced script, no
 * inline styles beyond the one stylesheet, data: images allowed.
 */
export class IconGridViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'iconotype.iconGrid'
  #view?: vscode.WebviewView
  #activeFont?: IconFont
  /** the icon to scroll to and outline after the next render */
  #focus?: string

  constructor(
    private registry: IconFontRegistry,
    private onCommand: (message: GridMessage) => void,
    private stale?: { isStale(font: IconFont): boolean },
  ) {
    registry.onDidChange(() => this.refresh())
  }

  get activeFont(): IconFont | undefined {
    return this.#activeFont && this.registry.get(this.#activeFont.uri) || this.registry.fonts[0]
  }

  show(font: IconFont, glyphId?: string): void {
    this.#activeFont = font
    this.#focus = glyphId
    this.refresh()
    void vscode.commands.executeCommand(`${IconGridViewProvider.viewType}.focus`)
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view
    view.webview.options = { enableScripts: true }
    view.webview.onDidReceiveMessage((message: GridMessage) => {
      if (message.type === 'selectFont') {
        this.#activeFont = this.registry.fonts.find((f) => f.uri.toString() === message.uri)
        this.refresh()
        return
      }
      this.onCommand(message)
    })
    this.refresh()
  }

  refresh(): void {
    if (!this.#view) return
    this.#view.webview.html = this.renderHtml(this.#view.webview)
  }

  /** Public so the integration tests can assert on the real markup. */
  renderHtml(webview: Pick<vscode.Webview, 'cspSource'>): string {
    const nonce = [...Array(32)].map(() => Math.random().toString(36)[2]).join('')
    const font = this.activeFont
    const fonts = this.registry.fonts

    const options = fonts
      .map((f) => `<option value="${f.uri.toString()}"${f === font ? ' selected' : ''}>${escapeHtml(f.name)}</option>`)
      .join('')

    const cells = !font
      ? `<div class="empty">
          <p>No icon font in this workspace yet.</p>
          <p><button class="primary" data-command="importProject">Import IcoMoon project…</button></p>
          <p><button data-command="create">Start an empty font</button></p>
          <p class="hint">An IcoMoon <code>.json</code>, a font package <code>.zip</code>, or a folder of SVGs.</p>
        </div>`
      : font.project.sets
          .flatMap((set) => set.glyphs)
          .map((glyph) => {
            const excluded = glyph.selected === false
            const focused = glyph.id === this.#focus
            const cp = font.project.codepoints[glyph.name]
            const codes = cp === undefined ? [] : Array.isArray(cp) ? cp : [cp]
            const code = codes.length ? codes[0]!.toString(16) : ''
            /**
             * A font glyph has no colour of its own — it paints in whatever the CSS
             * says. So a glyph carrying fills is a warning, and one carrying several
             * is worse: it costs a codepoint per layer and renders as stacked
             * characters. The dot says which, without opening anything.
             */
            const fills = [...new Set(glyph.attrs
              .map((a) => a?.fill)
              .filter((f): f is string => Boolean(f) && f !== 'none' && f !== 'currentColor'))]
            const dots = fills.length
              ? `<span class="dots" title="${fills.length} fill colour(s): ${escapeHtml(fills.join(' '))}">` +
                fills.slice(0, 3).map((f) => `<i style="background:${escapeHtml(f)}"></i>`).join('') +
                '</span>'
              : ''
            const layers = glyph.isMulticolor
              ? `<span class="layers" title="Multicolor: ${glyph.paths.length} layers using ${codes.length} codepoints">${codes.length}×</span>`
              : ''
            const title = `${glyph.name}${code ? ` U+${code}` : ''}${glyph.isMulticolor ? ' · multicolor' : ''}${excluded ? ' · excluded' : ''}`
            /**
             * A cell opens the icon; the tick includes or excludes it.
             *
             * Clicking the icon used to toggle whether it shipped, which is a
             * destructive-ish thing to have on the most casual gesture there is —
             * and opening it, the thing you actually want most often, was hidden
             * behind alt-click.
             *
             * The cell is a div, not a button: a button cannot legally contain the
             * tick's own button, and the tick has to be clickable on its own.
             */
            return `<div class="cell${excluded ? ' excluded' : ''}${focused ? ' focused' : ''}" data-id="${escapeHtml(glyph.id)}" data-name="${escapeHtml(glyph.name)}" title="${escapeHtml(title)}" role="button" tabindex="0">
              <button class="check${excluded ? '' : ' on'}" data-toggle="${escapeHtml(glyph.id)}" tabindex="-1"
                title="${excluded ? 'Excluded from the font — click to include' : 'Included in the font — click to exclude'}"
                aria-label="${excluded ? 'Include' : 'Exclude'} ${escapeHtml(glyph.name)}">${excluded ? '' : '✓'}</button>
              <img src="${glyphDataUri(font, glyph, 'currentColor', 24)}" alt="" width="24" height="24">
              <span class="name">${escapeHtml(glyph.name)}</span>
              <span class="code">${code}</span>
              ${dots}${layers}
            </div>`
          })
          .join('')

    const selectedCount = font ? this.registry.selected(font).length : 0
    const total = font ? font.project.sets.reduce((n, s) => n + s.glyphs.length, 0) : 0

    /**
     * Font settings, collapsed.
     *
     * The values that decide what an export actually produces — the prefix your code
     * writes and the two directories it lands in — used to be reachable only by
     * hand-editing the json. They are folded away because you set them once.
     */
    // the artwork on disk and the artwork in the font are two different things until
    // an export runs. This used to say so in a banner above the grid — which pushed
    // every icon down the moment you changed one, so the next tick you meant to click
    // had moved. It marks the Export button that is already in the toolbar instead.
    const pending = Boolean(font && (this.stale?.isStale(font) ?? false))

    const output = font?.project.output
    const settings = !font ? '' : `<details class="settings">
      <summary>Font settings</summary>
      <div class="field"><label for="s-prefix">Class prefix</label>
        <input id="s-prefix" data-setting="prefix" value="${escapeHtml(font.project.preferences.font.prefix)}"></div>
      <div class="field"><label for="s-usage" title="What your code writes, when a build step rewrites it">Usage prefix</label>
        <input id="s-usage" data-setting="usagePrefix" value="${escapeHtml((font.project.preferences.font.usagePrefixes ?? []).join(', '))}" placeholder="same as class prefix"></div>
      <div class="field"><label for="s-family">Font family</label>
        <input id="s-family" data-setting="family" value="${escapeHtml(font.project.preferences.font.family)}"></div>
      <div class="field"><label for="s-fonts">Fonts dir</label>
        <input id="s-fonts" data-setting="fontsDir" value="${escapeHtml(output?.fonts?.dir ?? '')}" placeholder="app/fonts"></div>
      <div class="field"><label for="s-styles">Stylesheet</label>
        <input id="s-styles" data-setting="stylePath" value="${escapeHtml(output?.styles?.[0]?.path ?? '')}" placeholder="app/css/_icons.scss"></div>
      <p class="hint">Written to ${escapeHtml(vscode.workspace.asRelativePath(font.uri))}. Enter to apply.</p>
    </details>`

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 6px; }
  .bar { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
  select, input { font: inherit; font-size: 11px; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
                  border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 2px 4px; }
  select { flex: 1; min-width: 90px; }
  input { flex: 1; min-width: 80px; }
  button { font: inherit; font-size: 11px; background: var(--vscode-button-secondaryBackground, transparent);
           color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
           border: 1px solid var(--vscode-contrastBorder, transparent); border-radius: 2px; padding: 2px 6px; cursor: pointer; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 4px; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px;
          background: transparent; border: 1px solid var(--vscode-panel-border); border-radius: 3px;
          overflow: hidden; cursor: pointer; color: var(--vscode-foreground); }
  .cell:hover { background: var(--vscode-list-hoverBackground); }
  .cell:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .check { position: absolute; top: 2px; right: 2px; width: 13px; height: 13px; padding: 0; line-height: 11px;
           font-size: 9px; text-align: center; border-radius: 3px; cursor: pointer;
           border: 1px solid var(--vscode-checkbox-border, var(--vscode-panel-border));
           background: var(--vscode-checkbox-background, transparent); color: transparent; }
  .check.on { background: var(--vscode-button-background); border-color: var(--vscode-button-background);
              color: var(--vscode-button-foreground); }
  .cell:hover .check { border-color: var(--vscode-focusBorder); }
  .cell.excluded { opacity: .4; }
  .cell.focused { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
  .dots { position: absolute; left: 3px; bottom: 3px; display: flex; gap: 1px; }
  .dots i { width: 5px; height: 5px; border-radius: 50%; display: block; box-shadow: 0 0 0 1px var(--vscode-panel-border); }
  .layers { position: absolute; right: 3px; bottom: 3px; font-size: 8px; font-family: var(--vscode-editor-font-family);
            color: var(--vscode-editorWarning-foreground); }
  .cell { position: relative; }
  details.settings { margin-top: 8px; border-top: 1px solid var(--vscode-panel-border); padding-top: 6px; }
  details.settings summary { font-size: 11px; cursor: pointer; opacity: .8; }
  details.settings .field { display: grid; grid-template-columns: 78px 1fr; align-items: center; gap: 4px; margin-top: 5px; }
  details.settings label { font-size: 10px; opacity: .75; }
  details.settings .hint { font-size: 9px; opacity: .55; margin: 6px 0 0; }
  .menu { position: fixed; z-index: 10; min-width: 150px; padding: 3px; border-radius: 4px;
          background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
          color: var(--vscode-menu-foreground, var(--vscode-foreground));
          border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); box-shadow: 0 2px 8px rgba(0,0,0,.35); }
  .menu button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 4px 8px; }
  .menu button:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
  .menu hr { border: 0; border-top: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); margin: 3px 0; }
  .cell.excluded .name { text-decoration: line-through; }
  .name { font-size: 9px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .code { font-size: 8px; opacity: .6; font-family: var(--vscode-editor-font-family); }
  .status { font-size: 10px; opacity: .7; margin: 6px 0 0; }
  /* the dot is always in the layout, only its paint changes: flipping to "pending"
     must not resize the toolbar or move anything under it */
  .dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; margin-left: 4px;
         background: transparent; vertical-align: middle; }
  button.pending { background: var(--vscode-statusBarItem-warningBackground, #cc6633);
                   color: var(--vscode-statusBarItem-warningForeground, #fff); }
  button.pending .dot { background: currentColor; }
  .status.pending { opacity: 1; color: var(--vscode-editorWarning-foreground, #d7a03c); }
  .empty { text-align: center; opacity: .9; font-size: 12px; padding: 8px 4px; }
  .empty p { margin: 8px 0; }
  .empty .hint { font-size: 10px; opacity: .6; }
</style>
</head>
<body>
  <div class="bar">
    <select id="font" title="Icon font">${options}</select>
    <button class="primary${pending ? ' pending' : ''}" data-command="export"
      title="${pending ? 'Font files are out of date — export now' : 'Build and write the font files'}">Export<i class="dot"></i></button>
    <button data-command="settings" title="Prefix, output paths and formats">⚙</button>
  </div>
  <div class="bar">
    <input id="filter" type="search" placeholder="Filter…">
    <button data-command="import" title="Add SVG files as icons">+ SVG</button>
    <button data-command="importIcons" title="Merge in an IcoMoon project or font package">+ Project</button>
    <button data-command="selectAll">All</button>
    <button data-command="selectNone">None</button>
  </div>
  <div class="grid" id="grid">${cells}</div>
  <p class="status${pending ? ' pending' : ''}">${selectedCount}/${total} selected for export${pending ? ' · font files are out of date' : ''} · click to open, tick to include, right-click for more</p>
  ${settings}

  <div class="menu" id="menu" hidden>
    <button data-action="open">Open in editor</button>
    <button data-action="usage">Show usage</button>
    <button data-action="replace">Replace SVG…</button>
    <hr>
    <button data-action="toggle">Include / exclude</button>
    <button data-action="copy">Copy class name</button>
    <hr>
    <button data-action="remove">Remove icon</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()
  document.getElementById('font')?.addEventListener('change', (e) => {
    vscode.postMessage({ type: 'selectFont', uri: e.target.value })
  })
  document.getElementById('filter')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase()
    for (const cell of document.querySelectorAll('.cell')) {
      cell.hidden = !cell.title.toLowerCase().includes(q)
    }
  })
  for (const button of document.querySelectorAll('[data-command]')) {
    button.addEventListener('click', () => vscode.postMessage({ type: button.dataset.command }))
  }
  document.querySelector('.cell.focused')?.scrollIntoView({ block: 'nearest' })

  const menu = document.getElementById('menu')
  let target = null

  const closeMenu = () => { if (menu) menu.hidden = true; target = null }
  document.addEventListener('click', closeMenu)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu() })
  window.addEventListener('blur', closeMenu)

  for (const check of document.querySelectorAll('[data-toggle]')) {
    check.addEventListener('click', (event) => {
      event.stopPropagation()
      vscode.postMessage({ type: 'toggle', id: check.dataset.toggle })
    })
  }

  for (const cell of document.querySelectorAll('.cell')) {
    cell.addEventListener('click', (event) => {
      // alt/ctrl still toggles, for anyone who learned the old gesture
      vscode.postMessage({ type: event.altKey || event.ctrlKey || event.metaKey ? 'toggle' : 'open', id: cell.dataset.id })
    })
    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      vscode.postMessage({ type: event.key === ' ' ? 'toggle' : 'open', id: cell.dataset.id })
    })
    cell.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!menu) return
      target = { id: cell.dataset.id, name: cell.dataset.name }
      menu.hidden = false
      // keep it on screen: flip when it would run off the right or bottom edge
      const width = menu.offsetWidth || 150
      const height = menu.offsetHeight || 180
      menu.style.left = Math.min(event.clientX, window.innerWidth - width - 4) + 'px'
      menu.style.top = Math.min(event.clientY, window.innerHeight - height - 4) + 'px'
    })
  }

  for (const entry of document.querySelectorAll('.menu button')) {
    entry.addEventListener('click', (event) => {
      event.stopPropagation()
      if (target) vscode.postMessage({ type: 'action', action: entry.dataset.action, id: target.id, name: target.name })
      closeMenu()
    })
  }

  for (const input of document.querySelectorAll('[data-setting]')) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      vscode.postMessage({ type: 'setting', key: input.dataset.setting, value: input.value })
    })
    input.addEventListener('change', () => {
      vscode.postMessage({ type: 'setting', key: input.dataset.setting, value: input.value })
    })
  }
</script>
</body>
</html>`
  }
}

export type GridAction = 'open' | 'usage' | 'replace' | 'toggle' | 'copy' | 'remove'

export type GridMessage =
  | { type: 'selectFont'; uri: string }
  | { type: 'action'; action: GridAction; id: string; name: string }
  | { type: 'setting'; key: 'prefix' | 'usagePrefix' | 'family' | 'fontsDir' | 'stylePath'; value: string }
  | { type: 'settings' }
  | { type: 'toggle'; id: string }
  | { type: 'open'; id: string }
  | { type: 'export' }
  | { type: 'import' }
  | { type: 'importIcons' }
  | { type: 'importProject' }
  | { type: 'create' }
  | { type: 'selectAll' }
  | { type: 'selectNone' }

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
