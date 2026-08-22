import * as vscode from 'vscode'
import { emptyProject, type Glyph, type Project } from '@glyphsmith/core-model'
import { ICONFONT_EXTENSION, parseIconFont, serializeIconFont, selectedGlyphs } from '@glyphsmith/core-io/iconfont-file'

/**
 * Every icon font in the workspace, kept loaded and watched.
 *
 * A workspace routinely has more than one (an app font and an admin font, say), so
 * everything downstream — completion, decorations, the tree — is keyed by project
 * rather than assuming a single global font.
 */

export interface IconFont {
  /** the file this came from */
  uri: vscode.Uri
  /** display name and the root of its class prefix, e.g. `app` */
  name: string
  /**
   * What the CODE writes, e.g. `app-` — what autocompletion triggers on and inserts.
   * Usually the class prefix, but `font.usagePrefixes` overrides it for a project
   * whose build rewrites references on the way in.
   */
  prefix: string
  /** the class prefix from the project's preferences, i.e. what the stylesheet declares */
  classPrefix: string
  /** every prefix a reference in source may be written with, longest first */
  prefixes: string[]
  project: Project
  /** parse failure, if the file is currently broken */
  error?: string
}

export interface IconRef {
  font: IconFont
  glyph: Glyph
  codepoints: number[]
  selected: boolean
}

const GLOB = `**/*${ICONFONT_EXTENSION}`

export class IconFontRegistry implements vscode.Disposable {
  #fonts = new Map<string, IconFont>()
  #watcher?: vscode.FileSystemWatcher
  #emitter = new vscode.EventEmitter<void>()
  #disposables: vscode.Disposable[] = []

  /** Fires whenever any font is added, changed or removed. */
  readonly onDidChange = this.#emitter.event

  get fonts(): IconFont[] {
    return [...this.#fonts.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(uri: vscode.Uri): IconFont | undefined { return this.#fonts.get(uri.toString()) }

  byName(name: string): IconFont | undefined {
    return this.fonts.find((f) => f.name === name)
  }

  /** All icons across all fonts; deselected ones are included but flagged. */
  icons(): IconRef[] {
    return this.fonts.flatMap((font) =>
      font.project.sets.flatMap((set) =>
        set.glyphs.map((glyph) => {
          const cp = font.project.codepoints[glyph.name]
          return {
            font,
            glyph,
            codepoints: cp === undefined ? [] : Array.isArray(cp) ? cp : [cp],
            selected: glyph.selected !== false,
          }
        })))
  }

  /** Every prefix any font in the workspace may be referenced by. */
  get prefixes(): string[] {
    return [...new Set(this.fonts.flatMap((f) => f.prefixes))].filter(Boolean)
  }

  /**
   * Splits a written reference into the font, the prefix it was written with and the
   * bare name — without requiring that the icon exists, so a typo can still be blamed
   * on the right font.
   */
  match(reference: string): { font: IconFont; prefix: string; name: string } | undefined {
    for (const font of this.fonts) {
      // longest first: `icon-` must not shadow `icon-outline-`
      for (const prefix of font.prefixes) {
        if (prefix && reference.startsWith(prefix)) {
          return { font, prefix, name: reference.slice(prefix.length) }
        }
      }
    }
    return undefined
  }

  /** Resolves a written reference like `app-home` back to its icon. */
  resolve(reference: string): IconRef | undefined {
    const hit = this.match(reference)
    if (!hit) return undefined
    return this.icons().find((i) => i.font === hit.font && i.glyph.name === hit.name)
  }

  async initialize(): Promise<void> {
    const configured = vscode.workspace.getConfiguration('glyphsmith').get<string[]>('projects') ?? []
    const uris = configured.length
      ? configured.flatMap((rel) =>
          (vscode.workspace.workspaceFolders ?? []).map((folder) => vscode.Uri.joinPath(folder.uri, rel)))
      : await vscode.workspace.findFiles(GLOB, '**/node_modules/**')

    await Promise.all(uris.map((uri) => this.load(uri)))

    this.#watcher = vscode.workspace.createFileSystemWatcher(GLOB)
    this.#disposables.push(
      this.#watcher,
      this.#watcher.onDidCreate((uri) => void this.load(uri)),
      this.#watcher.onDidChange((uri) => void this.load(uri)),
      this.#watcher.onDidDelete((uri) => {
        this.#fonts.delete(uri.toString())
        this.#emitter.fire()
      }),
    )
    this.#emitter.fire()
  }

  async load(uri: vscode.Uri): Promise<IconFont | undefined> {
    let font: IconFont
    try {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
      const project = parseIconFont(text, uri.toString())
      const classPrefix = project.preferences.font.prefix || `${project.name}-`
      const usage = (project.preferences.font.usagePrefixes ?? []).filter(Boolean)
      font = {
        uri,
        name: project.name,
        // what the code writes wins: it is what completion inserts and rename rewrites
        prefix: usage[0] ?? classPrefix,
        classPrefix,
        prefixes: [...new Set([...usage, classPrefix])].sort((a, b) => b.length - a.length),
        project,
      }
    } catch (e) {
      // keep a broken file visible rather than dropping it silently
      const previous = this.#fonts.get(uri.toString())
      const name = previous?.name ?? uri.path.split('/').pop()!.replace(ICONFONT_EXTENSION, '')
      font = {
        uri,
        name,
        prefix: previous?.prefix ?? '',
        classPrefix: previous?.classPrefix ?? '',
        prefixes: previous?.prefixes ?? [],
        // a real, complete project even when the file is broken: half of the extension
        // reads `preferences.font.family`, and a `{}` here crashed the usage scan
        project: previous?.project ?? emptyProject(uri.toString(), name),
        error: (e as Error).message,
      }
    }
    this.#fonts.set(uri.toString(), font)
    this.#emitter.fire()
    return font
  }

  /** Writes a project back to its file. The watcher then reloads it. */
  async save(font: IconFont, project: Project): Promise<void> {
    const text = serializeIconFont(project)
    await vscode.workspace.fs.writeFile(font.uri, new TextEncoder().encode(text))
    this.#fonts.set(font.uri.toString(), { ...font, project, error: undefined })
    this.#emitter.fire()
  }

  selected(font: IconFont): Glyph[] { return selectedGlyphs(font.project) }

  dispose(): void {
    for (const d of this.#disposables) d.dispose()
    this.#emitter.dispose()
  }
}
