import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { emptyProject, emptySet, allocate, parseLock, type Project } from '@glyphsmith/core-model'
import {
  fromIconFontFile, importIcoMoon, importIcoMoonZip, importSvg, isIcoMoonFile, isIconFontFile,
} from '@glyphsmith/core-io'

export interface LoadResult {
  project: Project
  warnings: string[]
  /** where a codepoints.lock was read from, if any */
  lockPath?: string
}

const svgFilesIn = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...svgFilesIn(full))
    else if (extname(entry).toLowerCase() === '.svg') out.push(full)
  }
  return out.sort()
}

/**
 * Loads a project from whatever the user points at: an IcoMoon or Glyphsmith JSON
 * file, an IcoMoon zip, or a directory of SVGs.
 *
 * A `codepoints.lock` next to the input is applied BEFORE allocation, which is what
 * makes a rebuild stable: names already in the lock keep their codepoints, new ones
 * are appended.
 */
export function loadProject(input: string, opts: { lock?: string; targetHeight?: number } = {}): LoadResult {
  const warnings: string[] = []
  const stat = statSync(input)
  let project: Project

  if (stat.isDirectory()) {
    const files = svgFilesIn(input)
    project = emptyProject('cli', input.replace(/\/+$/, '').split('/').pop() || 'icons')
    project.sets = [{ ...emptySet('cli-set-0', 'Icons'), height: opts.targetHeight ?? 1024 }]
    for (const file of files) {
      const name = file.split('/').pop()!
      try {
        const result = importSvg(readFileSync(file, 'utf8'), name, { targetHeight: project.sets[0]!.height })
        project.sets[0]!.glyphs.push(result.glyph)
        warnings.push(...result.warnings.map((w) => `${name}: ${w}`))
      } catch (e) {
        warnings.push((e as Error).message)
      }
    }
  } else if (extname(input).toLowerCase() === '.zip') {
    const result = importIcoMoonZip(readFileSync(input))
    project = result.project
    warnings.push(...result.warnings)
  } else {
    const data = JSON.parse(readFileSync(input, 'utf8')) as unknown
    if (isIconFontFile(data)) {
      // the committed `.glyphsmith.json` the editor extension reads and writes
      project = fromIconFontFile(data, input)
    } else if (isIcoMoonFile(data)) {
      const result = importIcoMoon(data)
      project = result.project
      warnings.push(...result.warnings)
    } else if (Array.isArray((data as Project).sets)) {
      project = data as Project
    } else {
      throw new Error(`${input}: not a Glyphsmith or IcoMoon project`)
    }
  }

  // apply the lockfile first, then allocate only what is genuinely new
  let lockPath: string | undefined
  if (opts.lock) {
    try {
      project.codepoints = { ...parseLock(readFileSync(opts.lock, 'utf8')), ...project.codepoints }
      lockPath = opts.lock
    } catch {
      // a missing lock is normal on a first run
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
    for (const name of overflow) warnings.push(`no codepoint available for "${name}" — the Private Use Area is full`)
  }

  return { project, warnings, lockPath }
}
