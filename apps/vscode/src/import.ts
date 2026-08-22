import * as vscode from 'vscode'
import {
  allocate, apply, emptyProject, emptySet,
  type Glyph, type Project, type StyleOutputKind,
} from '@iconotype/core-model'
import {
  fromIconFontFile, isIconFontFile, serializeIconFont, ICONFONT_EXTENSION,
} from '@iconotype/core-io/iconfont-file'
import { heavy } from './lazy.js'
import { outputConfigFor, styleFileName } from '@iconotype/core-export/layout'
import type { IconFont, IconFontRegistry } from './registry.js'

/**
 * Importing an existing project, from the UI.
 *
 * The CLI's `iconotype init` does the same job, but nobody should have to learn six
 * flags to open their own icon font. This asks the same questions as a wizard, with
 * the workspace settings as defaults, and writes the identical `.iconotype.json`
 * — the layout logic is shared (`outputConfigFor`) rather than reimplemented here.
 */

export interface ImportedSource {
  project: Project
  warnings: string[]
  /** what the user picked, for messages */
  label: string
}

const SVG_LIMIT = 2000

async function svgFilesIn(dir: vscode.Uri): Promise<vscode.Uri[]> {
  const out: vscode.Uri[] = []
  const walk = async (folder: vscode.Uri): Promise<void> => {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(folder)) {
      if (name.startsWith('.') || name === 'node_modules') continue
      const child = vscode.Uri.joinPath(folder, name)
      if (type === vscode.FileType.Directory) await walk(child)
      else if (name.toLowerCase().endsWith('.svg') && out.length < SVG_LIMIT) out.push(child)
    }
  }
  await walk(dir)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Reads whatever the user pointed at: an IcoMoon project or selection JSON, a
 * Iconotype file, an IcoMoon download zip, a zip of loose SVGs, or a folder of SVGs.
 *
 * Everything here is the same pure importer the CLI uses; only the reading differs,
 * because an extension must go through `workspace.fs` rather than `node:fs` (a remote
 * or virtual workspace has no local path at all).
 */
export async function readImportable(uri: vscode.Uri, targetHeight = 1024): Promise<ImportedSource> {
  const { importIcoMoon, importIcoMoonZip, importSvg, importSvgZip } = await heavy()
  const { isIcoMoonFile } = await import('@iconotype/core-io/icomoon-import')
  const label = vscode.workspace.asRelativePath(uri)
  const stat = await vscode.workspace.fs.stat(uri)

  if (stat.type === vscode.FileType.Directory) {
    const files = await svgFilesIn(uri)
    if (!files.length) throw new Error(`${label}: no .svg files in that folder`)
    const name = uri.path.replace(/\/+$/, '').split('/').pop() || 'icons'
    const project = emptyProject(uri.toString(), name)
    project.sets = [{ ...emptySet(`${uri.toString()}:set-0`, 'Icons'), height: targetHeight }]
    const warnings: string[] = []
    for (const file of files) {
      const fileName = file.path.split('/').pop()!
      try {
        const result = importSvg(
          new TextDecoder().decode(await vscode.workspace.fs.readFile(file)), fileName, { targetHeight })
        project.sets[0]!.glyphs.push(result.glyph)
        warnings.push(...result.warnings.map((w) => `${fileName}: ${w}`))
      } catch (e) {
        warnings.push((e as Error).message)
      }
    }
    if (!project.sets[0]!.glyphs.length) throw new Error(`${label}: none of the ${files.length} SVG(s) could be imported`)
    return { project, warnings, label }
  }

  const bytes = await vscode.workspace.fs.readFile(uri)

  if (uri.path.toLowerCase().endsWith('.zip')) {
    try {
      const result = importIcoMoonZip(bytes, { projectId: uri.toString() })
      return { ...result, label }
    } catch (icomoon) {
      // an SVG-only archive is the other thing IcoMoon hands out, and a common export
      // from Figma or Sketch — fall through to it rather than dead-ending
      const svg = importSvgZip(bytes, { targetHeight })
      if (!svg.glyphs.length) throw icomoon
      const name = uri.path.split('/').pop()!.replace(/\.zip$/i, '')
      const project = emptyProject(uri.toString(), name)
      project.sets = [{ ...emptySet(`${uri.toString()}:set-0`, 'Icons'), height: targetHeight, glyphs: svg.glyphs }]
      return { project, warnings: svg.warnings, label }
    }
  }

  let data: unknown
  try {
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch (e) {
    throw new Error(`${label}: not valid JSON — ${(e as Error).message}`)
  }

  if (isIconFontFile(data)) return { project: fromIconFontFile(data, uri.toString()), warnings: [], label }
  if (isIcoMoonFile(data)) return { ...importIcoMoon(data, { projectId: uri.toString() }), label }
  if (Array.isArray((data as Project).sets)) return { project: data as Project, warnings: [], label }
  throw new Error(`${label}: not an IcoMoon or Iconotype project`)
}

/** Fills in codepoints for anything the source did not carry one for. */
export function completeCodepoints(project: Project): string[] {
  const missing = project.sets
    .filter((s) => !s.hidden)
    .flatMap((s) => s.glyphs)
    .filter((g) => project.codepoints[g.name] === undefined)
    .map((g) => ({ name: g.name, layers: g.isMulticolor ? g.paths.length : 1 }))
  if (!missing.length) return []
  const { assignments, overflow } = allocate(project, missing)
  Object.assign(project.codepoints, assignments)
  return overflow
}

// ── the wizard ───────────────────────────────────────────────────────────────────

type SourceKind = 'icomoon-json' | 'zip' | 'folder'

const STYLE_KINDS: Array<{ kind: StyleOutputKind; label: string; detail: string }> = [
  { kind: 'scss-variables', label: 'SCSS variables', detail: '$app-home: "\\e900"; — a partial, plus the family and font path' },
  { kind: 'scss', label: 'SCSS stylesheet', detail: '@font-face and one .app-home rule per icon' },
  { kind: 'css', label: 'CSS stylesheet', detail: '@font-face and one .app-home rule per icon' },
  { kind: 'less-variables', label: 'LESS variables', detail: '@app-home: "\\e900";' },
  { kind: 'less', label: 'LESS stylesheet', detail: '@font-face and one rule per icon' },
  { kind: 'css-variables', label: 'CSS custom properties', detail: ':root { --app-home: "\\e900" }' },
  { kind: 'json', label: 'JSON map', detail: '{ "home": "e900" } for your own tooling' },
  { kind: 'dart', label: 'Dart IconData', detail: 'A Flutter icon class' },
]

export interface WizardResult {
  uri: vscode.Uri
  project: Project
  warnings: string[]
  iconCount: number
}

/** Where the new project file goes, and everything the user can decide about it. */
export interface Answers {
  name: string
  prefix: string
  fontsDir: string
  stylesDir: string
  styleKind: StyleOutputKind
  target: vscode.Uri
}

async function pickSource(): Promise<vscode.Uri | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(json) IcoMoon project or selection', description: '.json', source: 'icomoon-json' as SourceKind,
        detail: 'The file IcoMoon calls "Download / Project" — or a selection.json out of a font package' },
      { label: '$(file-zip) IcoMoon font package', description: '.zip', source: 'zip' as SourceKind,
        detail: 'The zip you download from IcoMoon; an SVG-only archive works too' },
      { label: '$(folder) Folder of SVG files', description: '', source: 'folder' as SourceKind,
        detail: 'Every .svg below the folder becomes an icon' },
    ],
    { placeHolder: 'What are you importing?', ignoreFocusOut: true },
  )
  if (!choice) return undefined

  const picked = await vscode.window.showOpenDialog(
    choice.source === 'folder'
      ? { canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Import SVGs' }
      : {
          canSelectMany: false,
          openLabel: 'Import',
          filters: choice.source === 'zip' ? { 'Font package': ['zip'] } : { 'IcoMoon project': ['json'] },
        },
  )
  return picked?.[0]
}

async function ask(source: ImportedSource, folder: vscode.Uri): Promise<Answers | undefined> {
  const settings = vscode.workspace.getConfiguration('iconotype', folder)
  const suggested = source.project.preferences.font.family || source.project.name || 'icons'

  const name = await vscode.window.showInputBox({
    title: `Import ${source.label} (1/5)`,
    prompt: 'Name for the icon font — the family name and the root of its class prefix',
    value: suggested.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'icons',
    ignoreFocusOut: true,
    validateInput: (v) => (/^[a-z][a-z0-9-]*$/i.test(v) ? undefined : 'letters, digits and dashes only'),
  })
  if (!name) return undefined

  const prefix = await vscode.window.showInputBox({
    title: `Import ${source.label} (2/5)`,
    prompt: 'Class prefix. Autocompletion triggers on it, and it is what your markup already writes.',
    value: source.project.preferences.font.prefix || `${name}-`,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : 'a prefix is required'),
  })
  if (prefix === undefined) return undefined

  const fontsDir = await vscode.window.showInputBox({
    title: `Import ${source.label} (3/5)`,
    prompt: 'Where the font files go, relative to the workspace root',
    value: settings.get<string>('defaults.fontsDir') || 'fonts',
    placeHolder: 'app/fonts',
    ignoreFocusOut: true,
  })
  if (fontsDir === undefined) return undefined

  const stylesDir = await vscode.window.showInputBox({
    title: `Import ${source.label} (4/5)`,
    prompt: 'Where the stylesheet or variables file goes',
    value: settings.get<string>('defaults.stylesDir') || 'css',
    placeHolder: 'app/css',
    ignoreFocusOut: true,
  })
  if (stylesDir === undefined) return undefined

  const configuredKind = settings.get<StyleOutputKind>('defaults.styleKind') ?? 'css'
  const kinds = [...STYLE_KINDS].sort((a, b) =>
    Number(b.kind === configuredKind) - Number(a.kind === configuredKind))
  const style = await vscode.window.showQuickPick(
    kinds.map((k) => ({
      label: k.label,
      description: `${(stylesDir || '.').replace(/\/+$/, '')}/${styleFileName(name, k.kind)}`,
      detail: k.detail,
      styleKind: k.kind,
    })),
    { title: `Import ${source.label} (5/5)`, placeHolder: 'What should the stylesheet be?', ignoreFocusOut: true },
  )
  if (!style) return undefined

  return {
    name, prefix, fontsDir, stylesDir, styleKind: style.styleKind,
    target: vscode.Uri.joinPath(folder, `${name}${ICONFONT_EXTENSION}`),
  }
}

/**
 * Applies the wizard's answers to the imported project.
 *
 * Split out from the prompting so it can be tested without driving dialogs, and so
 * the answers are visibly the ONLY thing that changes: codepoints come through from
 * the source untouched.
 */
export function prepareImported(
  source: ImportedSource, answers: Answers, scope?: vscode.Uri,
): { project: Project; warnings: string[] } {
  const project = source.project
  project.name = answers.name
  project.preferences.font.family = answers.name
  project.preferences.font.prefix = answers.prefix
  project.output = outputConfigFor({
    name: answers.name,
    fontsDir: answers.fontsDir,
    stylesDir: answers.stylesDir,
    styleKind: answers.styleKind,
    formats: vscode.workspace
      .getConfiguration('iconotype', scope)
      .get<Array<'woff2' | 'woff' | 'ttf' | 'svg'>>('defaults.formats') ?? ['woff2', 'woff', 'ttf'],
  })

  const warnings = [...source.warnings]
  for (const name of completeCodepoints(project)) {
    warnings.push(`no codepoint available for "${name}" — the Private Use Area is full`)
  }
  return { project, warnings }
}

/**
 * The whole flow: pick a source, answer five questions, get a committed project file.
 *
 * Codepoints from the source are kept exactly as they were. That matters more than
 * anything else here: an IcoMoon font already shipped to users has its codepoints
 * baked into every built stylesheet, and reassigning them would silently change which
 * glyph every existing class renders.
 */
export async function runImportWizard(
  registry: IconFontRegistry, sourceUri?: vscode.Uri,
): Promise<WizardResult | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri
  if (!folder) {
    vscode.window.showErrorMessage('Iconotype: open a folder before importing')
    return undefined
  }

  const uri = sourceUri ?? (await pickSource())
  if (!uri) return undefined

  const source = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Reading ${vscode.workspace.asRelativePath(uri)}…` },
    () => readImportable(uri),
  )

  const answers = await ask(source, folder)
  if (!answers) return undefined

  const { project, warnings } = prepareImported(source, answers, folder)

  // never clobber an existing project file without saying so
  try {
    await vscode.workspace.fs.stat(answers.target)
    const overwrite = await vscode.window.showWarningMessage(
      `${vscode.workspace.asRelativePath(answers.target)} already exists.`,
      { modal: true, detail: 'Overwriting replaces its icons and its codepoints.' },
      'Overwrite',
    )
    if (overwrite !== 'Overwrite') return undefined
  } catch {
    // does not exist yet, which is the normal case
  }

  await vscode.workspace.fs.writeFile(answers.target, new TextEncoder().encode(serializeIconFont(project)))
  await registry.load(answers.target)

  return {
    uri: answers.target,
    project,
    warnings,
    iconCount: project.sets.reduce((n, s) => n + s.glyphs.length, 0),
  }
}

// ── merging into an existing font ────────────────────────────────────────────────

export interface MergeResult {
  added: Glyph[]
  /** names already in the target font, left untouched */
  skipped: string[]
  warnings: string[]
}

/**
 * Adds another project's icons to a font that already exists.
 *
 * Existing names are skipped rather than overwritten: a name collision between two
 * icon sets is nearly always two different drawings, and silently replacing artwork
 * that is already referenced in the codebase is the worse of the two failure modes.
 * Source codepoints are only honoured when free — the target's own allocation wins.
 */
export async function mergeIntoFont(
  registry: IconFontRegistry, font: IconFont, source: ImportedSource,
): Promise<MergeResult> {
  const set = font.project.sets[0]
  if (!set) throw new Error(`${font.name} has no icon set to add to`)

  const existing = new Set(font.project.sets.flatMap((s) => s.glyphs).map((g) => g.name))
  const taken = new Set(
    Object.values(font.project.codepoints).flatMap((c) => (Array.isArray(c) ? c : [c])))

  const added: Glyph[] = []
  const skipped: string[] = []
  const keep: Record<string, number | number[]> = {}

  for (const glyph of source.project.sets.flatMap((s) => s.glyphs)) {
    if (existing.has(glyph.name)) { skipped.push(glyph.name); continue }
    existing.add(glyph.name)
    added.push({ ...glyph, id: `${font.uri.toString()}:${glyph.name}` })

    const cp = source.project.codepoints[glyph.name]
    const codes = cp === undefined ? [] : Array.isArray(cp) ? cp : [cp]
    if (codes.length && codes.every((c) => !taken.has(c))) {
      for (const c of codes) taken.add(c)
      keep[glyph.name] = cp!
    }
  }

  if (!added.length) return { added, skipped, warnings: source.warnings }

  let project = apply(font.project, { t: 'glyph.add', setId: set.id, glyphs: added }).next
  if (Object.keys(keep).length) {
    project = apply(project, { t: 'codepoint.assign', assignments: keep }).next
  }
  const still = added.filter((g) => project.codepoints[g.name] === undefined)
  if (still.length) {
    const { assignments, overflow } = allocate(
      project, still.map((g) => ({ name: g.name, layers: g.isMulticolor ? g.paths.length : 1 })))
    project = apply(project, { t: 'codepoint.assign', assignments }).next
    for (const name of overflow) source.warnings.push(`no codepoint available for "${name}"`)
  }

  await registry.save(font, project)
  return { added, skipped, warnings: source.warnings }
}

/** One line summarising a merge, for the notification. */
export const describeMerge = (font: IconFont, result: MergeResult): string => {
  const parts = [`added ${result.added.length} icon(s) to ${font.name}`]
  if (result.skipped.length) parts.push(`${result.skipped.length} already there (${result.skipped.slice(0, 3).join(', ')}${result.skipped.length > 3 ? '…' : ''})`)
  if (result.warnings.length) parts.push(`${result.warnings.length} warning(s), see the output panel`)
  return `Iconotype: ${parts.join(' · ')}`
}
