import * as vscode from 'vscode'
import { buildStamp, outputPaths } from '@iconotype/core-export/layout'
import { resolveOutputConfig } from './export.js'
import type { IconFont, IconFontRegistry } from './registry.js'

/**
 * Whether each font's generated files still match its project.
 *
 * Editing an icon changes nothing on disk until an export runs, and until now nothing
 * said so: the woff2 your app loads and the scss it compiles simply went on being the
 * old ones. This tracks the fingerprint of the last export and compares it with the
 * project as it stands.
 *
 * The stamp lives in workspace state, not in a committed file. Staleness is a local
 * question — "have I exported since I edited?" — and CI always builds from scratch,
 * so a file in the repo would be one more thing to merge for no gain.
 */
export class ExportState implements vscode.Disposable {
  #emitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.#emitter.event
  #stale = new Map<string, boolean>()
  #disposables: vscode.Disposable[] = []

  constructor(private registry: IconFontRegistry, private memento: vscode.Memento) {
    this.#disposables.push(registry.onDidChange(() => void this.refresh()))
  }

  #key = (font: IconFont) => `stamp:${font.uri.toString()}`

  /** Called after a successful export: this is now the state on disk. */
  async record(font: IconFont): Promise<void> {
    await this.memento.update(this.#key(font), buildStamp({ ...font.project, output: resolveOutputConfig(font) }))
    await this.refresh()
  }

  isStale(font: IconFont): boolean { return this.#stale.get(font.uri.toString()) ?? false }
  get staleFonts(): IconFont[] { return this.registry.fonts.filter((f) => this.isStale(f)) }

  async refresh(): Promise<void> {
    const next = new Map<string, boolean>()
    for (const font of this.registry.fonts) {
      next.set(font.uri.toString(), await this.#check(font))
    }
    const changed =
      next.size !== this.#stale.size || [...next].some(([k, v]) => this.#stale.get(k) !== v)
    this.#stale = next
    if (changed) this.#emitter.fire()
  }

  async #check(font: IconFont): Promise<boolean> {
    if (font.error) return false
    const project = { ...font.project, output: resolveOutputConfig(font) }
    // nothing selected means an export would refuse anyway, so it is not "pending"
    if (!project.sets.some((s) => s.glyphs.some((g) => g.selected !== false))) return false

    const root = vscode.workspace.getWorkspaceFolder(font.uri)?.uri ?? vscode.Uri.joinPath(font.uri, '..')
    // a fresh clone has the project file but not the build output: that is stale
    // regardless of what any stamp says
    for (const path of outputPaths(project)) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, path))
      } catch {
        return true
      }
    }
    return this.memento.get<string>(this.#key(font)) !== buildStamp(project)
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose()
    this.#emitter.dispose()
  }
}

export type AutoExport = 'off' | 'onSave' | 'onChange'

/** The configured policy, honouring the older boolean setting. */
export function autoExportMode(scope?: vscode.Uri): AutoExport {
  const config = vscode.workspace.getConfiguration('iconotype', scope)
  const mode = config.get<AutoExport>('autoExport')
  if (mode && mode !== 'off') return mode
  // `exportOnSave` predates the three-way setting; true still means onSave
  return config.get<boolean>('exportOnSave', false) ? 'onSave' : (mode ?? 'off')
}
