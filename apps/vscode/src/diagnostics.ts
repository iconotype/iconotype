import * as vscode from 'vscode'
import { referencePattern, SUPPORTED_LANGUAGES } from './language.js'
import type { IconFontRegistry } from './registry.js'

/**
 * Catches references to icons that do not exist.
 *
 * The classic icon-font failure is a typo or a renamed icon: `app-hme` renders nothing
 * at all, silently, and no test in the app notices. The registry already knows every
 * real name, so this is free — including the "did you mean" fix.
 */

const MAX_DISTANCE = 3

/** Levenshtein, capped — only used to suggest an alternative for a short name. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > MAX_DISTANCE) return MAX_DISTANCE + 1
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      previous = current
    }
  }
  return row[b.length]!
}

export class IconDiagnostics implements vscode.Disposable {
  #collection = vscode.languages.createDiagnosticCollection('iconotype')
  #timer?: ReturnType<typeof setTimeout>

  constructor(private registry: IconFontRegistry) {}

  get collection(): vscode.DiagnosticCollection { return this.#collection }

  schedule(document: vscode.TextDocument): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.refresh(document), 250)
  }

  refresh(document: vscode.TextDocument): void {
    if (!SUPPORTED_LANGUAGES.includes(document.languageId)) return
    const enabled = vscode.workspace.getConfiguration('iconotype').get<boolean>('diagnostics.enabled', true)
    this.#collection.set(document.uri, enabled ? this.diagnosticsFor(document) : [])
  }

  /** Exposed for testing: what a document would be flagged with. */
  diagnosticsFor(document: vscode.TextDocument): vscode.Diagnostic[] {
    const pattern = referencePattern(this.registry.prefixes)
    if (!pattern) return []

    const text = document.getText()
    const out: vscode.Diagnostic[] = []

    for (const match of text.matchAll(pattern)) {
      const reference = match[0]
      const resolved = this.registry.resolve(reference)
      // resolve() finds an icon whether or not it is selected, so check that here:
      // an excluded icon is a real reference to a glyph that will not be in the font
      if (resolved?.selected) continue

      const hit = this.registry.match(reference)
      const font = resolved?.font ?? hit?.font
      if (!font || !hit) continue
      // report the name against the prefix it was actually written with
      const name = hit.name
      const excluded = Boolean(resolved)

      const range = new vscode.Range(document.positionAt(match.index!), document.positionAt(match.index! + reference.length))
      if (excluded) {
        const diagnostic = new vscode.Diagnostic(
          range,
          `"${reference}" exists but is excluded from the built font, so it will render nothing.`,
          vscode.DiagnosticSeverity.Warning,
        )
        diagnostic.code = 'excluded-icon'
        diagnostic.source = 'iconotype'
        out.push(diagnostic)
        continue
      }

      const names = this.registry.icons().filter((i) => i.font === font && i.selected).map((i) => i.glyph.name)
      const suggestion = names
        .map((candidate) => ({ candidate, d: distance(name, candidate) }))
        .filter((c) => c.d <= MAX_DISTANCE)
        .sort((a, b) => a.d - b.d)[0]?.candidate

      const diagnostic = new vscode.Diagnostic(
        range,
        suggestion
          ? `"${reference}" is not an icon in ${font.name}. Did you mean "${hit.prefix}${suggestion}"?`
          : `"${reference}" is not an icon in ${font.name}.`,
        vscode.DiagnosticSeverity.Warning,
      )
      diagnostic.code = 'unknown-icon'
      diagnostic.source = 'iconotype'
      // carried so the quick fix does not have to recompute it
      ;(diagnostic as vscode.Diagnostic & { suggestion?: string }).suggestion =
        suggestion ? `${hit.prefix}${suggestion}` : undefined
      out.push(diagnostic)
    }
    return out
  }

  clear(uri: vscode.Uri): void { this.#collection.delete(uri) }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#collection.dispose()
  }
}

/** Offers the suggested name as a one-click fix. */
export class IconQuickFixes implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix]

  provideCodeActions(
    document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = []
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'iconotype') continue
      const suggestion = (diagnostic as vscode.Diagnostic & { suggestion?: string }).suggestion
      if (!suggestion) continue

      const action = new vscode.CodeAction(`Replace with "${suggestion}"`, vscode.CodeActionKind.QuickFix)
      action.diagnostics = [diagnostic]
      action.isPreferred = true
      action.edit = new vscode.WorkspaceEdit()
      action.edit.replace(document.uri, diagnostic.range, suggestion)
      actions.push(action)
    }
    return actions
  }
}
