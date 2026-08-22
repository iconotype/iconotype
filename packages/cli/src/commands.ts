import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { allocate, emptySet, hex, serializeLock, type Project, type StyleOutputKind } from '@iconotype/core-model'
import {
  exportIcoMoonSelection, fetchIconRefs, parseIconRef, searchIcons, serializeIconFont, setMetadataFor,
  toGlyphs, ICONFONT_EXTENSION, type CollectionInfo,
} from '@iconotype/core-io'
import { buildBundle, buildFont } from '@iconotype/core-font'
import {
  buildFavicons, buildPngs, buildSpriteSheet, componentFilename, exportComponent,
  exportSpriteSymbols, exportSvg, exportTypes, iconsOf, outputConfigFor, resolveOutputs,
  type ComponentTarget, type Rasterizer,
} from '@iconotype/core-export'
import { fixSvg, fixPaths } from '@iconotype/core-svg'
import { loadProject } from './load.js'

export interface Io {
  log: (msg: string) => void
  error: (msg: string) => void
}

/** resvg is the node-side rasterizer; the browser supplies OffscreenCanvas instead. */
const rasterize: Rasterizer = async (svg, width) =>
  new Uint8Array(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng())

const write = (root: string, path: string, data: Uint8Array | string): void => {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, typeof data === 'string' ? data : Buffer.from(data))
}

// ── build ────────────────────────────────────────────────────────────────────────

export interface BuildArgs {
  input: string
  /** omit to write to the paths the project's own `output` config names */
  out?: string
  lock?: string
  formats?: string[]
  components?: ComponentTarget[]
  sprite?: boolean
  png?: boolean
  favicon?: string
  types?: boolean
  quiet?: boolean
}

/**
 * Where the lockfile lives: inside a folder of SVGs, or beside a project file.
 * Getting this wrong silently starts a fresh allocation on every build, which is
 * exactly the codepoint drift the lock exists to prevent.
 */
export const defaultLockPath = (input: string): string =>
  statSync(input).isDirectory() ? join(input, 'codepoints.lock') : join(dirname(input), 'codepoints.lock')

export async function build(args: BuildArgs, io: Io): Promise<number> {
  const lockPath = args.lock ?? defaultLockPath(args.input)
  const { project, warnings } = loadProject(args.input, { lock: lockPath })
  for (const w of warnings) io.error(`warning: ${w}`)

  /**
   * A project that says where its output goes gets written there — the same paths the
   * editor extension writes, so a build from CI and a build from the editor produce
   * the same tree. `--out` switches to the packaged layout instead.
   */
  if (!args.out && project.output) {
    const root = statSync(args.input).isDirectory() ? args.input : dirname(args.input)
    const { files, build: direct } = await resolveOutputs(project, { timestamp: 0 })
    for (const file of files) write(root, file.path, file.data)
    for (const w of direct.warnings) io.error(`warning: ${w.code}: ${w.message}`)
    writeFileSync(lockPath, serializeLock(project))
    if (!args.quiet) {
      io.log(`built ${direct.glyphs.length} glyph(s) → ${files.map((f) => f.path).join(', ')}`)
    }
    return 0
  }

  const out = args.out ?? 'dist'

  const { files, build: font } = await buildBundle(project, {
    formats: (args.formats as never) ?? ['woff2', 'woff', 'ttf'],
    // deterministic: identical input must produce identical bytes
    timestamp: 0,
    selectionJson: JSON.stringify(exportIcoMoonSelection(project), null, 2),
  })
  for (const f of files) write(out, f.path, f.data)
  for (const w of font.warnings) io.error(`warning: ${w.code}: ${w.message}`)

  const entries = iconsOf(project)

  if (args.sprite) {
    write(out, 'sprite.svg', exportSpriteSymbols(project, entries))
    const sheet = buildSpriteSheet(project, entries)
    write(out, 'sprite.png', await rasterize(sheet.svg, sheet.width, sheet.height))
    write(out, 'sprite.css', sheet.css)
  }
  if (args.png) {
    for (const png of await buildPngs(entries, rasterize, { retina: true })) write(out, png.path, png.data)
  }
  if (args.favicon) {
    const entry = entries.find((e) => e.glyph.name === args.favicon)
    if (!entry) {
      io.error(`error: --favicon "${args.favicon}" is not an icon in this project`)
      return 1
    }
    for (const f of await buildFavicons(entry, rasterize, { name: project.name })) write(out, f.path, f.data)
  }
  for (const target of args.components ?? []) {
    write(out, componentFilename(target, project), exportComponent(target, project, entries))
  }
  if (args.types) write(out, 'icons.d.ts', exportTypes(project, entries))

  // the lock is the contract with everything already using this font
  writeFileSync(lockPath, serializeLock(project))

  if (!args.quiet) {
    io.log(`built ${font.glyphs.length} glyph(s) from ${entries.length} icon(s) into ${out}`)
  }
  return 0
}

// ── init ─────────────────────────────────────────────────────────────────────────

export interface InitArgs {
  input: string
  out?: string
  name?: string
  prefix?: string
  fontsDir?: string
  stylesDir?: string
  styleKind?: string
  formats?: string[]
  types?: string
}

/**
 * Converts anything importable — an IcoMoon project, a font zip, a folder of SVGs —
 * into a committed `.iconotype.json`, wired to where your build wants the output.
 * This is the on-ramp for the editor extension and for CI.
 */
export async function init(args: InitArgs, io: Io): Promise<number> {
  const { project, warnings } = loadProject(args.input)
  for (const w of warnings) io.error(`warning: ${w}`)

  const name = args.name ?? project.preferences.font.family ?? 'icons'
  project.name = name
  project.preferences.font.family = name
  if (args.prefix) project.preferences.font.prefix = args.prefix

  const styleKind = (args.styleKind ?? 'css') as StyleOutputKind
  const stylesDir = (args.stylesDir ?? 'css').replace(/\/+$/, '')
  project.output = outputConfigFor({
    name,
    fontsDir: args.fontsDir,
    stylesDir,
    styleKind,
    formats: args.formats as Array<'woff2' | 'woff' | 'ttf' | 'svg'>,
    typesPath: args.types,
  })

  const out = args.out ?? `${name}${ICONFONT_EXTENSION}`
  mkdirSync(dirname(out) || '.', { recursive: true })
  writeFileSync(out, serializeIconFont(project))

  const icons = project.sets.reduce((n, s) => n + s.glyphs.length, 0)
  io.log(`wrote ${out} — ${icons} icon(s), fonts to ${project.output.fonts!.dir}/, styles to ${stylesDir}/`)
  io.log(`next: open the folder in VSCode and run "Iconotype: Export Font", or: iconotype build --input ${out}`)
  return 0
}


// ── find / add ───────────────────────────────────────────────────────────────────

export interface FindArgs { query: string; limit?: number; prefixes?: string[]; json?: boolean; host?: string }

/**
 * Searching the open icon libraries from a terminal.
 *
 * The output is `prefix:name`, one per line, which is exactly what `add` takes — so
 * `iconotype find chevron` and then pasting two of the lines into `iconotype add` is
 * the whole workflow, and piping through grep works the way you would expect.
 */
export async function find(args: FindArgs, io: Io): Promise<number> {
  const result = await searchIcons(args.query, {
    limit: args.limit ?? 48,
    prefixes: args.prefixes,
    host: args.host,
  })
  if (args.json) {
    io.log(JSON.stringify({ total: result.total, icons: result.icons.map((r) => `${r.prefix}:${r.name}`), collections: result.collections }, null, 2))
    return result.icons.length ? 0 : 1
  }
  if (!result.icons.length) {
    io.error(`nothing matched "${args.query}"`)
    return 1
  }
  for (const ref of result.icons) {
    const licence = result.collections[ref.prefix]?.license?.title
    io.log(`${ref.prefix}:${ref.name}${licence ? `  (${licence})` : ''}`)
  }
  if (result.total > result.icons.length) io.log(`\n${result.icons.length} of ${result.total} — raise --limit for more`)
  return 0
}

export interface AddArgs { input: string; refs: string[]; out?: string; host?: string; qualify?: boolean }

/**
 * Adds library icons to a project file and writes it back.
 *
 * One set per collection, because a set carries a licence and merging ISC artwork into
 * a CC BY 4.0 set makes the set's own attribution a lie. Codepoints are allocated the
 * same way every other path allocates them, so a font already in production keeps
 * every number it had.
 */
export async function add(args: AddArgs, io: Io): Promise<number> {
  const refs = args.refs.map(parseIconRef)
  const bad = args.refs.filter((_, i) => refs[i] === null)
  if (bad.length) {
    io.error(`error: not icon references: ${bad.join(', ')} — expected prefix:name, e.g. lucide:house`)
    return 2
  }
  const wanted = refs.filter((r): r is NonNullable<typeof r> => r !== null)
  if (!wanted.length) {
    io.error('error: add needs at least one icon — iconotype add lucide:house mdi:home')
    return 2
  }

  const { project, warnings } = loadProject(args.input)
  for (const w of warnings) io.error(`warning: ${w}`)

  const icons = await fetchIconRefs(wanted, { host: args.host })
  const found = new Set(icons.map((i) => `${i.prefix}:${i.name}`))
  for (const ref of wanted) {
    if (!found.has(`${ref.prefix}:${ref.name}`)) io.error(`warning: ${ref.prefix}:${ref.name} — the library does not have it`)
  }
  if (!icons.length) return 1

  // the collection metadata rides along with the search index, so it is fetched here
  const { listCollections } = await import('@iconotype/core-io')
  let collections: Record<string, CollectionInfo> = {}
  try {
    collections = await listCollections({ host: args.host })
  } catch {
    // attribution is better than nothing, but a missing index must not block the add
    io.error('warning: could not read the collection index — icons will be added without licence metadata')
  }

  const taken = new Set(project.sets.flatMap((s) => s.glyphs).map((g) => g.name))
  let added = 0

  for (const prefix of new Set(icons.map((i) => i.prefix))) {
    const collection = collections[prefix]
    const name = collection?.name ?? prefix
    let set = project.sets.find((s) => s.name === name)
    if (!set) {
      set = { ...emptySet(`set-${prefix}`, name), metadata: collection ? setMetadataFor(collection) : {} }
      project.sets.push(set)
    }
    const results = toGlyphs(icons.filter((i) => i.prefix === prefix), collections, {
      targetHeight: set.height,
      taken,
      qualifyNames: args.qualify,
    })
    for (const r of results) {
      set.glyphs.push(r.glyph)
      for (const w of r.warnings) io.error(`warning: ${r.ref.prefix}:${r.ref.name}: ${w}`)
      added++
    }
  }

  const missing = project.sets
    .filter((s) => !s.hidden)
    .flatMap((s) => s.glyphs)
    .filter((g) => project.codepoints[g.name] === undefined)
    .map((g) => ({ name: g.name, layers: g.isMulticolor ? g.paths.length : 1 }))
  if (missing.length) {
    const { assignments, overflow } = allocate(project, missing)
    Object.assign(project.codepoints, assignments)
    for (const name of overflow) io.error(`error: no codepoint available for "${name}" — the Private Use Area is full`)
  }

  const out = args.out ?? args.input
  writeFileSync(out, serializeIconFont(project))
  io.log(`added ${added} icon(s) to ${out}`)
  io.log(`next: iconotype build --input ${out}`)
  return 0
}

// ── lint ─────────────────────────────────────────────────────────────────────────

export interface LintArgs { input: string; json?: boolean; maxWarnings?: number }

export async function lint(args: LintArgs, io: Io): Promise<number> {
  const { project } = loadProject(args.input)
  const report: Array<{ glyph: string; code: string; severity: string; message: string }> = []

  const isDir = statSync(args.input).isDirectory()
  if (isDir) {
    // lint the SOURCE files, so findings cover everything the pipeline had to fix
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const full = join(dir, e)
        return statSync(full).isDirectory() ? walk(full) : extname(e).toLowerCase() === '.svg' ? [full] : []
      })
    for (const file of walk(args.input).sort()) {
      const name = relative(args.input, file)
      try {
        for (const f of fixSvg(readFileSync(file, 'utf8')).findings) {
          if (f.severity === 'info') continue
          report.push({ glyph: name, code: f.code, severity: f.severity, message: f.message })
        }
      } catch (e) {
        report.push({ glyph: name, code: 'PARSE_FAILED', severity: 'error', message: (e as Error).message })
      }
    }
  } else {
    for (const set of project.sets) {
      for (const glyph of set.glyphs) {
        for (const f of fixPaths(glyph.paths, { targetHeight: set.height, attrs: glyph.attrs }).findings) {
          if (f.severity === 'info') continue
          report.push({ glyph: glyph.name, code: f.code, severity: f.severity, message: f.message })
        }
      }
    }
  }

  const errors = report.filter((r) => r.severity === 'error')
  const warnings = report.filter((r) => r.severity === 'warning')

  if (args.json) {
    io.log(JSON.stringify({ errors: errors.length, warnings: warnings.length, findings: report }, null, 2))
  } else {
    for (const r of report) io.log(`${r.severity === 'error' ? 'error' : 'warn '} ${r.glyph}: ${r.code} — ${r.message}`)
    io.log(`${errors.length} error(s), ${warnings.length} warning(s)`)
  }

  if (errors.length) return 1
  if (args.maxWarnings !== undefined && warnings.length > args.maxWarnings) return 1
  return 0
}

// ── fix ──────────────────────────────────────────────────────────────────────────

export interface FixArgs { input: string; write?: boolean; simplify?: number; snap?: number; refit?: boolean }

export async function fix(args: FixArgs, io: Io): Promise<number> {
  if (!statSync(args.input).isDirectory()) {
    io.error('error: fix operates on a directory of .svg files')
    return 1
  }
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = join(dir, e)
      return statSync(full).isDirectory() ? walk(full) : extname(e).toLowerCase() === '.svg' ? [full] : []
    })

  let changed = 0
  for (const file of walk(args.input).sort()) {
    const source = readFileSync(file, 'utf8')
    const result = fixSvg(source, {
      simplifyTolerance: args.simplify ?? 0,
      snapGrid: args.snap ?? 0,
      fit: args.refit ? 'contain' : 'none',
    })
    if (!result.paths.length) {
      io.error(`skipped ${relative(args.input, file)}: nothing drawable`)
      continue
    }
    const fixed =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
      result.paths.map((d, i) => {
        const fill = result.attrs[i]?.fill
        return `<path${fill ? ` fill="${fill}"` : ''} d="${d}"/>`
      }).join('') +
      `</svg>\n`
    if (fixed === source) continue
    changed++
    if (args.write) writeFileSync(file, fixed)
    else io.log(`would fix ${relative(args.input, file)}`)
  }
  io.log(args.write ? `fixed ${changed} file(s)` : `${changed} file(s) would change (pass --write to apply)`)
  return 0
}

// ── diff ─────────────────────────────────────────────────────────────────────────

export interface DiffEntry { name: string; from?: number | number[]; to?: number | number[] }
export interface DiffResult {
  added: DiffEntry[]
  removed: DiffEntry[]
  moved: DiffEntry[]
  changed: string[]
  breaking: boolean
}

const codeString = (v: number | number[] | undefined): string =>
  v === undefined ? '—' : (Array.isArray(v) ? v : [v]).map((c) => `U+${hex(c)}`).join(' ')

const glyphMap = (project: Project): Map<string, string> => {
  const out = new Map<string, string>()
  for (const set of project.sets) for (const g of set.glyphs) out.set(g.name, g.paths.join(''))
  return out
}

/**
 * Compares two projects as an API surface.
 *
 * Removing a glyph or moving its codepoint BREAKS every build already referencing it —
 * a stale stylesheet keeps pointing at the old codepoint and renders the wrong icon.
 * That is the gate CI needs.
 */
export function diffProjects(before: Project, after: Project): DiffResult {
  const added: DiffEntry[] = []
  const removed: DiffEntry[] = []
  const moved: DiffEntry[] = []
  const changed: string[] = []

  const beforeGlyphs = glyphMap(before)
  const afterGlyphs = glyphMap(after)

  for (const [name, code] of Object.entries(after.codepoints)) {
    const old = before.codepoints[name]
    if (old === undefined) added.push({ name, to: code })
    else if (JSON.stringify(old) !== JSON.stringify(code)) moved.push({ name, from: old, to: code })
  }
  for (const [name, code] of Object.entries(before.codepoints)) {
    if (after.codepoints[name] === undefined) removed.push({ name, from: code })
  }
  for (const [name, paths] of afterGlyphs) {
    const old = beforeGlyphs.get(name)
    if (old !== undefined && old !== paths) changed.push(name)
  }

  const sort = (a: DiffEntry, b: DiffEntry) => a.name.localeCompare(b.name)
  return {
    added: added.sort(sort),
    removed: removed.sort(sort),
    moved: moved.sort(sort),
    changed: changed.sort(),
    breaking: removed.length > 0 || moved.length > 0,
  }
}

export interface DiffArgs { before: string; after: string; json?: boolean; allowBreaking?: boolean }

export async function diff(args: DiffArgs, io: Io): Promise<number> {
  const before = loadProject(args.before).project
  const after = loadProject(args.after).project
  const result = diffProjects(before, after)

  if (args.json) {
    io.log(JSON.stringify(result, null, 2))
  } else {
    for (const e of result.added) io.log(`added    ${e.name} ${codeString(e.to)}`)
    for (const e of result.removed) io.log(`REMOVED  ${e.name} ${codeString(e.from)}`)
    for (const e of result.moved) io.log(`MOVED    ${e.name} ${codeString(e.from)} -> ${codeString(e.to)}`)
    for (const name of result.changed) io.log(`changed  ${name} (same codepoint, new artwork)`)
    io.log(
      `${result.added.length} added, ${result.removed.length} removed, ` +
      `${result.moved.length} moved, ${result.changed.length} redrawn`,
    )
    if (result.breaking) {
      io.error('BREAKING: a removed or moved codepoint changes what existing builds render.')
    }
  }
  return result.breaking && !args.allowBreaking ? 1 : 0
}

// ── scan ─────────────────────────────────────────────────────────────────────────

export interface ScanArgs { input: string; source: string; json?: boolean; failOnUnused?: boolean }

const SOURCE_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.scss', '.less', '.js', '.jsx', '.ts', '.tsx',
  '.vue', '.svelte', '.astro', '.md', '.mdx', '.php', '.erb', '.hbs', '.xml',
])
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.svelte-kit', '.next'])

/** Finds which icons a codebase actually references. */
export function scanSources(
  root: string, names: string[], prefix: string, skip: Set<string> = new Set(),
): Map<string, number> {
  const counts = new Map<string, number>(names.map((n) => [n, 0]))
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      if (IGNORED_DIRS.has(entry)) return []
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) return walk(full)
      return SOURCE_EXTENSIONS.has(extname(entry).toLowerCase()) ? [full] : []
    })

  for (const file of walk(root)) {
    // never count our own output: the generated stylesheet names every single icon,
    // so including it makes everything look used and the report worthless
    if (skip.has(resolve(file))) continue
    const text = readFileSync(file, 'utf8')
    for (const name of names) {
      // the class (`icon-home`), the bare name in a component prop, or the ligature
      const pattern = new RegExp(`(?:${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
      const hits = text.match(pattern)
      if (hits) counts.set(name, (counts.get(name) ?? 0) + hits.length)
    }
  }
  return counts
}

export async function scan(args: ScanArgs, io: Io): Promise<number> {
  const { project } = loadProject(args.input)
  const entries = iconsOf(project)
  const names = entries.map((e) => e.glyph.name)
  const counts = scanSources(args.source, names, project.preferences.font.prefix, generatedPaths(project, args.input))
  const unused = names.filter((n) => (counts.get(n) ?? 0) === 0).sort()

  if (args.json) {
    io.log(JSON.stringify({
      total: names.length,
      used: names.length - unused.length,
      unused,
      counts: Object.fromEntries(counts),
    }, null, 2))
  } else {
    for (const name of unused) io.log(`unused   ${name}`)
    io.log(`${names.length - unused.length}/${names.length} icon(s) referenced in ${args.source}`)
    if (unused.length) io.log(`subset with: iconotype build --input ${args.input} --only ${names.filter((n) => !unused.includes(n)).join(',')}`)
  }
  return args.failOnUnused && unused.length ? 1 : 0
}

/** Absolute paths of every file a build writes for this project. */
export function generatedPaths(project: Project, input: string): Set<string> {
  const root = statSync(input).isDirectory() ? input : dirname(input)
  const out = new Set<string>()
  const add = (rel?: string) => { if (rel) out.add(resolve(root, rel)) }
  for (const style of project.output?.styles ?? []) add(style.path)
  add(project.output?.types?.path)
  add(project.output?.sprite?.path)
  add(project.output?.demo?.path)
  return out
}

// ── info ─────────────────────────────────────────────────────────────────────────

export async function info(args: { input: string; json?: boolean }, io: Io): Promise<number> {
  const { project, warnings } = loadProject(args.input)
  const font = await buildFont(project, { formats: ['ttf'], timestamp: 0 })
  const summary = {
    name: project.name,
    family: project.preferences.font.family,
    sets: project.sets.map((s) => ({ name: s.name, glyphs: s.glyphs.length, height: s.height, hidden: s.hidden })),
    icons: iconsOf(project).length,
    glyphs: font.glyphs.length,
    emSize: font.metrics.unitsPerEm,
    ttfBytes: font.ttf?.byteLength ?? 0,
    warnings: warnings.length,
  }
  if (args.json) {
    io.log(JSON.stringify(summary, null, 2))
  } else {
    io.log(`${summary.name} — family "${summary.family}", em ${summary.emSize}`)
    for (const set of summary.sets) {
      io.log(`  ${set.hidden ? '(hidden) ' : ''}${set.name}: ${set.glyphs} glyph(s) at ${set.height} units`)
    }
    io.log(`  ${summary.icons} icon(s) → ${summary.glyphs} glyph(s), ${(summary.ttfBytes / 1024).toFixed(1)} kB ttf`)
  }
  return 0
}

export { loadProject, exportSvg }
