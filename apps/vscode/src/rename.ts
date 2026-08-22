import * as vscode from 'vscode'
import { apply } from '@iconotype/core-model'
import { serializeIconFont } from '@iconotype/core-io/iconfont-file'
import type { IconFontRegistry, IconRef } from './registry.js'
import type { UsageIndex } from './usage.js'

/**
 * Renaming an icon, everywhere.
 *
 * A rename touches three things that must stay in step: the project file, every
 * reference in the workspace, and the codepoint — which must NOT move, or every build
 * already shipping this font renders the wrong glyph. F2 on `app-home` does all three
 * in one undoable workspace edit.
 */
export class IconRenameProvider implements vscode.RenameProvider {
  constructor(private registry: IconFontRegistry, private usage: UsageIndex) {}

  prepareRename(document: vscode.TextDocument, position: vscode.Position): { range: vscode.Range; placeholder: string } {
    const { icon, range } = this.#at(document, position)
    if (!icon || !range) throw new Error('Not an icon reference')
    return { range, placeholder: `${icon.font.prefix}${icon.glyph.name}` }
  }

  async provideRenameEdits(
    document: vscode.TextDocument, position: vscode.Position, newName: string,
  ): Promise<vscode.WorkspaceEdit | undefined> {
    const { icon } = this.#at(document, position)
    if (!icon) return undefined

    // accept either `app-home` or bare `home`
    const stripped = icon.font.prefixes.find((p) => p && newName.startsWith(p))
    const bare = stripped ? newName.slice(stripped.length) : newName
    if (!/^[a-zA-Z0-9_-]+$/.test(bare)) {
      throw new Error('An icon name may only contain letters, digits, dashes and underscores')
    }
    if (bare === icon.glyph.name) return undefined
    if (this.registry.icons().some((i) => i.font === icon.font && i.glyph.name === bare)) {
      throw new Error(`${icon.font.name} already has an icon called "${bare}"`)
    }

    const edit = new vscode.WorkspaceEdit()

    // 1. the project file: rename the glyph and MOVE ITS CODEPOINT ACROSS unchanged
    const codepoint = icon.font.project.codepoints[icon.glyph.name]
    let project = apply(icon.font.project, {
      t: 'glyph.patch', id: icon.glyph.id, patch: { name: bare },
    }).next
    if (codepoint !== undefined) {
      project = apply(project, { t: 'codepoint.assign', assignments: { [bare]: codepoint } }).next
      delete project.codepoints[icon.glyph.name]
    }
    const document0 = await vscode.workspace.openTextDocument(icon.font.uri)
    edit.replace(
      icon.font.uri,
      new vscode.Range(0, 0, document0.lineCount, 0),
      serializeIconFont(project),
    )

    // 2. every reference in the workspace
    await this.usage.scan()
    const sites = this.usage.for(icon)?.sites ?? []
    for (const site of sites) {
      // each site keeps the prefix it was written with: a project may reference the
      // same icon as `icon-home` in css and `alpimaps-home` in code
      const prefix = site.prefix || icon.font.prefix
      edit.replace(
        site.uri,
        new vscode.Range(site.line, site.column, site.line, site.column + prefix.length + icon.glyph.name.length),
        `${prefix}${bare}`,
      )
    }
    return edit
  }

  #at(document: vscode.TextDocument, position: vscode.Position): { icon?: IconRef; range?: vscode.Range } {
    const range = document.getWordRangeAtPosition(position, /[\w-]+/)
    if (!range) return {}
    const icon = this.registry.resolve(document.getText(range))
    return icon ? { icon, range } : {}
  }
}

/** Jump from a reference in code to the icon's entry in the project file. */
export class IconDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private registry: IconFontRegistry) {}

  async provideDefinition(
    document: vscode.TextDocument, position: vscode.Position,
  ): Promise<vscode.Location | undefined> {
    const range = document.getWordRangeAtPosition(position, /[\w-]+/)
    if (!range) return undefined
    const icon = this.registry.resolve(document.getText(range))
    if (!icon) return undefined

    const target = await vscode.workspace.openTextDocument(icon.font.uri)
    const needle = `"name": "${icon.glyph.name}"`
    const offset = target.getText().indexOf(needle)
    return new vscode.Location(
      icon.font.uri,
      offset >= 0 ? target.positionAt(offset) : new vscode.Position(0, 0),
    )
  }
}

/** Find-all-references over the usage index. */
export class IconReferenceProvider implements vscode.ReferenceProvider {
  constructor(private registry: IconFontRegistry, private usage: UsageIndex) {}

  async provideReferences(
    document: vscode.TextDocument, position: vscode.Position,
  ): Promise<vscode.Location[]> {
    const range = document.getWordRangeAtPosition(position, /[\w-]+/)
    if (!range) return []
    const icon = this.registry.resolve(document.getText(range))
    if (!icon) return []

    if (!this.usage.for(icon)) await this.usage.scan()
    return (this.usage.for(icon)?.sites ?? []).map((site) =>
      new vscode.Location(
        site.uri,
        new vscode.Range(
          site.line, site.column,
          site.line, site.column + (site.prefix || icon.font.prefix).length + icon.glyph.name.length),
      ))
  }
}
