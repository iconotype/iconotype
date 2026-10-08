import * as vscode from 'vscode'
import { emptyProject, type Glyph, type Project } from '@iconotype/core-model'
import { ICONFONT_EXTENSION, parseIconFont, serializeIconFont, selectedGlyphs } from '@iconotype/core-io/iconfont-file'

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
  /** what identifies the file; unlike `name`, no two loaded fonts share it */
  id: string
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
  /**
   * The prefixes the code is expected to WRITE, longest first: `usagePrefixes` when the
   * project declares them, otherwise the class prefix.
   *
   * Narrower than `prefixes` on purpose. A project whose build rewrites references
   * still has its class prefix appear in source — in a hand-written stylesheet, say —
   * and that is a real use worth counting. It is not somewhere a name the font lacks
   * means anything: declare `usagePrefixes: ["app-"]` against a class prefix of
   * `icon-`, and every unrelated `icon-…` in the workspace reads as a missing icon.
   */
  usagePrefixes: string[]
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

/**
 * What identifies a file, whatever route its uri took to get here.
 *
 * The discovery scan, the `iconotype.projects` setting and the file watcher each build
 * their own uri for the same file, and on a case-insensitive disk they need not agree on
 * case. Keying the map by `uri.toString()` then held one project twice — in the tree,
 * the grid's picker and the status bar alike.
 */
const keyOf = (uri: vscode.Uri): string => {
  const plain = uri.with({ query: '', fragment: '' })
  return plain.scheme === 'file' && (process.platform === 'darwin' || process.platform === 'win32')
    ? plain.with({ path: plain.path.toLowerCase() }).toString()
    : plain.toString()
}

const isMissing = (e: unknown): boolean =>
  e instanceof vscode.FileSystemError
    ? e.code === 'FileNotFound'
    : (e as { code?: string })?.code === 'FileNotFound' || (e as { code?: string })?.code === 'ENOENT'

export class IconFontRegistry implements vscode.Disposable {
  #fonts = new Map<string, IconFont>()
  /**
   * The newest load started for each file. A load is asynchronous, and a save, a branch
   * switch or a delete can overlap it: only the latest may touch the map, or a read that
   * began before the file vanished puts it back.
   */
  #loads = new Map<string, number>()
  #loadCounter = 0
  /** the files the `iconotype.projects` setting names, or undefined when everything is discovered */
  #configured?: Set<string>
  #watcher?: vscode.FileSystemWatcher
  #emitter = new vscode.EventEmitter<void>()
  #disposables: vscode.Disposable[] = []

  /** Fires whenever any font is added, changed or removed. */
  readonly onDidChange = this.#emitter.event

  get fonts(): IconFont[] {
    return [...this.#fonts.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(uri: vscode.Uri): IconFont | undefined { return this.#fonts.get(keyOf(uri)) }

  /** True when another loaded font goes by the same name, so the name alone does not say which. */
  isAmbiguous(font: IconFont): boolean {
    return this.fonts.some((f) => f !== font && f.name === font.name)
  }

  /** Where the file is, relative to its workspace folder: the part that tells two same-named fonts apart. */
  location(font: IconFont): string {
    return vscode.workspace.asRelativePath(font.uri)
  }

  /** The name, with the path added only when the name alone would be confusing. */
  label(font: IconFont): string {
    return this.isAmbiguous(font) ? `${font.name} — ${this.location(font)}` : font.name
  }

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

  /**
   * `match`, restricted to the prefixes the code is expected to write.
   *
   * Used where a reference the font cannot answer is a finding rather than a fact:
   * matching on the class prefix there turns any unrelated `icon-…` into an invented
   * missing icon.
   */
  matchWritten(reference: string): { font: IconFont; prefix: string; name: string } | undefined {
    for (const font of this.fonts) {
      // longest first: `icon-` must not shadow `icon-outline-`
      for (const prefix of font.usagePrefixes) {
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
    // a second call must replace the first's watcher, not add to it
    for (const d of this.#disposables.splice(0)) d.dispose()

    const configured = vscode.workspace.getConfiguration('iconotype').get<string[]>('projects') ?? []
    const candidates = configured.length
      ? configured.flatMap((rel) =>
          (vscode.workspace.workspaceFolders ?? []).map((folder) => vscode.Uri.joinPath(folder.uri, rel)))
      : await vscode.workspace.findFiles(GLOB, this.#excludeGlob())
    // one entry per file, however many routes led to it
    const uris = [...new Map(candidates.map((uri) => [keyOf(uri), uri])).values()]
    this.#configured = configured.length ? new Set(uris.map(keyOf)) : undefined

    // what the new settings no longer cover goes; load() below brings back what they do
    const keep = new Set(uris.map(keyOf))
    for (const key of [...this.#fonts.keys()]) if (!keep.has(key)) this.#fonts.delete(key)
    await Promise.all(uris.map((uri) => this.load(uri)))

    this.#watcher = vscode.workspace.createFileSystemWatcher(GLOB)
    const wanted = async (uri: vscode.Uri) => this.#configured
      ? this.#configured.has(keyOf(uri))
      // a font already known is wanted; a new one must clear the exclude list, which the
      // watcher cannot do for us — ask the search, which applies it
      : this.#fonts.has(keyOf(uri)) || await this.#discoverable(uri)
    this.#disposables.push(
      this.#watcher,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('iconotype.projects') || e.affectsConfiguration('iconotype.exclude')) {
          void this.initialize()
        }
      }),
      this.#watcher.onDidCreate(async (uri) => { if (await wanted(uri)) void this.load(uri) }),
      this.#watcher.onDidChange(async (uri) => { if (await wanted(uri)) void this.load(uri) }),
      this.#watcher.onDidDelete((uri) => {
        this.#loads.set(keyOf(uri), ++this.#loadCounter) // a read still in flight must not bring it back
        if (this.#fonts.delete(keyOf(uri))) this.#emitter.fire()
      }),
    )
    this.#emitter.fire()
  }

  /** `{a,b}` for findFiles, or undefined for none; an empty list really does exclude nothing. */
  #excludeGlob(): string | null {
    const patterns = (vscode.workspace.getConfiguration('iconotype').get<string[]>('exclude') ?? [])
      .map((p) => p.trim()).filter(Boolean)
    return patterns.length ? `{${patterns.join(',')}}` : null
  }

  /** Whether a scan with the exclude list would have found this file. */
  async #discoverable(uri: vscode.Uri): Promise<boolean> {
    const folder = vscode.workspace.getWorkspaceFolder(uri)
    if (!folder) return false
    const rel = vscode.workspace.asRelativePath(uri, false)
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, rel), this.#excludeGlob())
    return found.length > 0
  }

  async load(uri: vscode.Uri): Promise<IconFont | undefined> {
    const key = keyOf(uri)
    const ticket = ++this.#loadCounter
    this.#loads.set(key, ticket)
    let font: IconFont
    try {
      let bytes: Uint8Array
      try {
        bytes = await vscode.workspace.fs.readFile(uri)
      } catch (e) {
        // A file that is not there is not a broken font. Keeping it listed made a
        // `iconotype.projects` entry that exists in only one workspace folder show up in
        // the others as a phantom copy, and left a deleted file behind if the read lost
        // the race with the delete.
        if (isMissing(e)) {
          if (this.#loads.get(key) === ticket && this.#fonts.delete(key)) this.#emitter.fire()
          return undefined
        }
        throw e
      }
      const text = new TextDecoder().decode(bytes)
      const project = parseIconFont(text, uri.toString())
      const classPrefix = project.preferences.font.prefix || `${project.name}-`
      const usage = (project.preferences.font.usagePrefixes ?? []).filter(Boolean)
      font = {
        uri,
        id: key,
        name: project.name,
        // what the code writes wins: it is what completion inserts and rename rewrites
        prefix: usage[0] ?? classPrefix,
        classPrefix,
        prefixes: [...new Set([...usage, classPrefix])].sort((a, b) => b.length - a.length),
        usagePrefixes: (usage.length ? [...new Set(usage)] : [classPrefix])
          .sort((a, b) => b.length - a.length),
        project,
      }
    } catch (e) {
      // keep a broken file visible rather than dropping it silently
      const previous = this.#fonts.get(key)
      const name = previous?.name ?? uri.path.split('/').pop()!.replace(ICONFONT_EXTENSION, '')
      font = {
        uri,
        id: key,
        name,
        prefix: previous?.prefix ?? '',
        classPrefix: previous?.classPrefix ?? '',
        prefixes: previous?.prefixes ?? [],
        usagePrefixes: previous?.usagePrefixes ?? [],
        // a real, complete project even when the file is broken: half of the extension
        // reads `preferences.font.family`, and a `{}` here crashed the usage scan
        project: previous?.project ?? emptyProject(uri.toString(), name),
        error: (e as Error).message,
      }
    }
    // a newer load of this file is under way, or it was deleted meanwhile
    if (this.#loads.get(key) !== ticket) return this.#fonts.get(key)
    this.#fonts.set(key, font)
    this.#emitter.fire()
    return font
  }

  /** Writes a project back to its file. The watcher then reloads it. */
  async save(font: IconFont, project: Project): Promise<void> {
    const text = serializeIconFont(project)
    await vscode.workspace.fs.writeFile(font.uri, new TextEncoder().encode(text))
    // the project just written is newer than any read that began before it
    this.#loads.set(keyOf(font.uri), ++this.#loadCounter)
    this.#fonts.set(keyOf(font.uri), { ...font, project, error: undefined })
    this.#emitter.fire()
  }

  selected(font: IconFont): Glyph[] { return selectedGlyphs(font.project) }

  dispose(): void {
    for (const d of this.#disposables) d.dispose()
    this.#emitter.dispose()
  }
}
