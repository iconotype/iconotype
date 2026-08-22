import * as vscode from 'vscode'
import type { Glyph } from '@iconotype/core-model'
import type { IconFont, IconRef } from './registry.js'

/**
 * Glyph rendering for editor chrome.
 *
 * VSCode's TreeItem and decoration APIs take a Uri for an icon. `data:` URIs are not
 * reliably rendered by either, so glyphs are written as real SVG files into the
 * extension's storage and referenced by file Uri. They are cached by content hash, so
 * a redraw only costs a write the first time.
 */

const height = (font: IconFont, glyph: Glyph): number => {
  const set = font.project.sets.find((s) => s.glyphs.some((g) => g.id === glyph.id))
  return set?.height ?? 1024
}

export function glyphSvg(font: IconFont, glyph: Glyph, color: string, size = 16): string {
  const box = height(font, glyph)
  const body = glyph.paths
    .map((d, i) => `<path fill="${glyph.attrs[i]?.fill ?? color}" d="${d}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}">${body}</svg>`
}

/** A data URI, for places that DO accept one — markdown hovers and webviews. */
export const glyphDataUri = (font: IconFont, glyph: Glyph, color = '#888', size = 16): string =>
  `data:image/svg+xml;base64,${Buffer.from(glyphSvg(font, glyph, color, size)).toString('base64')}`

const hash = (text: string): string => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export class GlyphIconCache implements vscode.Disposable {
  #dir: vscode.Uri
  #written = new Set<string>()

  constructor(context: vscode.ExtensionContext) {
    /**
     * globalStorageUri can carry the `vscode-userdata` scheme, and decoration
     * `contentIconPath` is not documented to resolve one. The same location as a
     * plain file: URI always renders, so pin the scheme where a real path exists.
     */
    const storage = context.globalStorageUri
    const base = storage.fsPath ? vscode.Uri.file(storage.fsPath) : storage
    this.#dir = vscode.Uri.joinPath(base, 'glyph-icons')
  }

  /**
   * Light and dark variants, as VSCode expects for tree items. The glyph itself is
   * monochrome, so the two differ only in the ink colour.
   */
  async iconPath(font: IconFont, glyph: Glyph): Promise<{ light: vscode.Uri; dark: vscode.Uri }> {
    const [light, dark] = await Promise.all([
      this.#write(font, glyph, '#3b3b3b'),
      this.#write(font, glyph, '#cccccc'),
    ])
    return { light, dark }
  }

  async #write(font: IconFont, glyph: Glyph, color: string): Promise<vscode.Uri> {
    const svg = glyphSvg(font, glyph, color, 16)
    const name = `${hash(svg)}.svg`
    const uri = vscode.Uri.joinPath(this.#dir, name)
    if (this.#written.has(name)) return uri
    try {
      await vscode.workspace.fs.createDirectory(this.#dir)
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(svg))
      this.#written.add(name)
    } catch {
      // a failed cache write only costs us the icon, never the feature
    }
    return uri
  }

  dispose(): void { this.#written.clear() }
}

/** The hover card shown over an icon reference. */
export function describeIcon(icon: IconRef): vscode.MarkdownString {
  const codes = icon.codepoints.map((c) => `U+${c.toString(16).toUpperCase()}`).join(' ')
  const preview = glyphDataUri(icon.font, icon.glyph, '#888', 48)
  const md = new vscode.MarkdownString()
  md.supportHtml = true
  md.appendMarkdown(`![${icon.glyph.name}](${preview}|width=48,height=48)\n\n`)
  md.appendMarkdown(`**${icon.font.prefix}${icon.glyph.name}** · \`${codes}\`\n\n`)
  if (!icon.selected) md.appendMarkdown(`⚠️ excluded from the built font\n\n`)
  const details: string[] = [`font \`${icon.font.name}\``]
  if (icon.glyph.tags.length && icon.glyph.tags.join() !== icon.glyph.name) details.push(`tags: ${icon.glyph.tags.join(', ')}`)
  if (icon.glyph.aliases.length) details.push(`ligatures: ${icon.glyph.aliases.join(', ')}`)
  if (icon.glyph.source?.license) details.push(`licence: ${icon.glyph.source.license}`)
  md.appendMarkdown(details.join(' · '))
  md.isTrusted = true
  return md
}
