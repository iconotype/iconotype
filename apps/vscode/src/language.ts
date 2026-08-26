import * as vscode from 'vscode'
import { describeIcon, type GlyphIconCache } from './render.js'
import type { IconFontRegistry, IconRef } from './registry.js'

/**
 * The editor-facing half of the extension: completion, hover and inline previews for
 * icon references written anywhere in the workspace.
 */

export const SUPPORTED_LANGUAGES = [
  'html', 'css', 'scss', 'less', 'javascript', 'javascriptreact', 'typescript',
  'typescriptreact', 'vue', 'svelte', 'astro', 'markdown', 'php', 'handlebars', 'xml', 'json',
]

/**
 * `app-home`, `icon-user`, … — a reference to an icon in one of the workspace's fonts.
 *
 * The boundaries are the whole difficulty. A bare `prefix + name` match reads
 * `@akylas/nativescript-app-utils/error` as a reference to `app-utils`, and an import
 * list is long enough that a handful of those bury every real finding — the scan calls
 * them used, and the missing-icon report invents icons nobody ever wrote.
 *
 * So the prefix may not continue a longer word (`nativescript-app-utils`, `myapp-`),
 * and neither end may sit against a `/`, because a module path segment is the one
 * thing that looks exactly like a reference and never is. Everything a reference is
 * genuinely written against still counts: quotes, whitespace, `.` in a selector, `:`
 * in a Svelte class directive, `"` before a self-closing `/>`.
 *
 * The trailing lookahead spans name characters rather than testing one, or the engine
 * would backtrack to a shorter match and hand back `app-util` out of `app-utils/`.
 */
export function referencePattern(prefixes: string[]): RegExp | null {
  const usable = prefixes.filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!usable.length) return null
  return new RegExp(
    `(?<![A-Za-z0-9_/-])(?:${usable.join('|')})[a-zA-Z0-9_-]+(?![a-zA-Z0-9_-]*\\/)`, 'g')
}

/** `\e900` in a stylesheet, or `` in JS — the codepoint written directly. */
const ESCAPE_PATTERN = /\\u?([0-9a-fA-F]{4,5})\b/g

export class IconCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private registry: IconFontRegistry) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const line = document.lineAt(position).text.slice(0, position.character)
    const items: vscode.CompletionItem[] = []

    for (const font of this.registry.fonts) {
      if (!font.prefix) continue
      // offer completions as soon as the font's prefix has been typed, even partially:
      // `app-` after `class="` , but also bare `app-ho`
      const typed = new RegExp(`([\\w-]*)$`).exec(line)?.[1] ?? ''
      // any prefix the code may use should offer this font's icons; the completion
      // itself always inserts `font.prefix`, which is what this project writes
      const partial = font.prefixes.some((p) => p.startsWith(typed) || typed.startsWith(p))
      if (!partial) continue

      const range = new vscode.Range(position.translate(0, -typed.length), position)
      for (const icon of this.registry.icons()) {
        if (icon.font !== font) continue
        // only icons that will actually be in the built font are offered
        if (!icon.selected) continue
        items.push(this.#item(icon, range))
      }
    }
    return items
  }

  #item(icon: IconRef, range: vscode.Range): vscode.CompletionItem {
    const label = `${icon.font.prefix}${icon.glyph.name}`
    const item = new vscode.CompletionItem(
      { label, description: icon.font.name },
      vscode.CompletionItemKind.Color,
    )
    item.range = range
    item.insertText = label
    item.filterText = `${label} ${icon.glyph.tags.join(' ')}`
    item.detail = icon.codepoints.map((c) => `U+${c.toString(16).toUpperCase()}`).join(' ')
    item.documentation = describeIcon(icon)
    // keep icons above the language's own suggestions when the prefix matched
    item.sortText = `0_${icon.glyph.name}`
    return item
  }
}

export class IconHoverProvider implements vscode.HoverProvider {
  constructor(private registry: IconFontRegistry) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const range = document.getWordRangeAtPosition(position, /[\w-]+/)
    if (!range) return undefined
    const icon = this.registry.resolve(document.getText(range))
    if (!icon) return undefined
    return new vscode.Hover(describeIcon(icon), range)
  }
}

/**
 * Inline previews.
 *
 * The glyph is drawn as a data-URI SVG in a `before` decoration attached to the
 * reference, so the actual artwork sits next to the name in the source.
 */
export class IconDecorator implements vscode.Disposable {
  #type = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  })
  #timer?: ReturnType<typeof setTimeout>
  /** glyph key → the cached SVG file drawn beside the reference */
  #paths = new Map<string, vscode.Uri>()

  constructor(private registry: IconFontRegistry, private icons: GlyphIconCache) {
    // artwork changed: whatever was rendered for these glyphs is no longer right
    registry.onDidChange(() => this.#paths.clear())
  }

  /**
   * Renders the glyphs a document actually mentions, and only those.
   *
   * `contentIconPath` takes a Uri, and a `data:` URI comes back from `Uri.parse`
   * percent-encoded (`image/svg%2Bxml`), which is not worth relying on. Files always
   * render, and the cache makes each write a one-off.
   *
   * This used to run over every glyph in the workspace at activation — two file writes
   * each, in sequence, before the window was usable. A 500-icon font paid a thousand
   * writes for a file that might reference four of them.
   */
  async warm(document?: vscode.TextDocument): Promise<void> {
    const wanted = document ? this.#referenced(document) : this.registry.icons()
    await Promise.all(wanted.map(async (icon) => {
      const key = `${icon.font.name}/${icon.glyph.name}`
      if (this.#paths.has(key)) return
      const { dark } = await this.icons.iconPath(icon.font, icon.glyph)
      this.#paths.set(key, dark)
    }))
  }

  /** The icons one document mentions, deduplicated. */
  #referenced(document: vscode.TextDocument): IconRef[] {
    const text = document.getText()
    const out = new Map<string, IconRef>()
    const pattern = referencePattern(this.registry.prefixes)
    if (pattern) {
      for (const match of text.matchAll(pattern)) {
        const icon = this.registry.resolve(match[0])
        if (icon) out.set(`${icon.font.name}/${icon.glyph.name}`, icon)
      }
    }
    for (const match of text.matchAll(ESCAPE_PATTERN)) {
      const code = parseInt(match[1]!, 16)
      const icon = this.registry.icons().find((i) => i.codepoints.includes(code))
      if (icon) out.set(`${icon.font.name}/${icon.glyph.name}`, icon)
    }
    return [...out.values()]
  }

  /** Debounced: typing in a large file should not re-render every keystroke. */
  schedule(editor: vscode.TextEditor | undefined): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => void this.render(editor), 120)
  }

  /** Renders what this editor needs, then decorates it. */
  async render(editor: vscode.TextEditor | undefined): Promise<void> {
    if (!editor) return
    await this.warm(editor.document)
    this.refresh(editor)
  }

  iconPathFor(icon: IconRef): vscode.Uri | undefined {
    return this.#paths.get(`${icon.font.name}/${icon.glyph.name}`)
  }

  refresh(editor: vscode.TextEditor | undefined): void {
    if (!editor) return
    const enabled = vscode.workspace.getConfiguration('iconotype').get<boolean>('decorations.enabled', true)
    if (!enabled) {
      editor.setDecorations(this.#type, [])
      return
    }
    editor.setDecorations(this.#type, this.decorationsFor(editor.document))
  }

  /** Exposed for testing: the decorations a document would get. */
  decorationsFor(document: vscode.TextDocument): vscode.DecorationOptions[] {
    const text = document.getText()
    const out: vscode.DecorationOptions[] = []
    const seen = new Set<string>()

    const add = (start: number, end: number, icon: IconRef) => {
      const key = `${start}:${end}`
      if (seen.has(key)) return
      seen.add(key)
      const iconPath = this.iconPathFor(icon)
      out.push({
        range: new vscode.Range(document.positionAt(start), document.positionAt(end)),
        hoverMessage: describeIcon(icon),
        ...(iconPath ? {
          renderOptions: {
            before: { contentIconPath: iconPath, margin: '0 3px 0 0', width: '0.95em', height: '0.95em' },
          },
        } : {}),
      })
    }

    const pattern = referencePattern(this.registry.prefixes)
    if (pattern) {
      for (const match of text.matchAll(pattern)) {
        const icon = this.registry.resolve(match[0])
        if (icon) add(match.index!, match.index! + match[0].length, icon)
      }
    }

    for (const match of text.matchAll(ESCAPE_PATTERN)) {
      const code = parseInt(match[1]!, 16)
      const icon = this.registry.icons().find((i) => i.codepoints.includes(code))
      if (icon) add(match.index!, match.index! + match[0].length, icon)
    }

    return out
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#type.dispose()
  }
}
