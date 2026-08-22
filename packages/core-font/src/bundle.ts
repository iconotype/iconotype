import type { Project } from '@iconotype/core-model'
import { serializeLock } from '@iconotype/core-model'
import { buildFont, type BuildOptions, type FontBuild } from './build.js'
import { buildCss, buildDemoHtml, buildVariables, groupIcons, type CssOptions } from './css.js'

export interface BundleFile { path: string; data: Uint8Array | string }

export interface BundleOptions extends BuildOptions, CssOptions {
  /** IcoMoon-compatible selection.json, supplied by core-io to avoid a package cycle */
  selectionJson?: string
  includeDemo?: boolean
  includeVariables?: boolean
  includeLock?: boolean
  includeAttribution?: boolean
}

/** Aggregates per-set licences so mixed icon sets can be attributed properly. */
export function buildAttribution(project: Project): string {
  const lines = [`# Attribution — ${project.preferences.font.family}`, '']
  for (const set of project.sets) {
    if (!set.glyphs.length) continue
    lines.push(`## ${set.name} (${set.glyphs.length} icon${set.glyphs.length === 1 ? '' : 's'})`)
    const m = set.metadata
    if (m.license) lines.push(`- License: ${m.license}${m.licenseURL ? ` — ${m.licenseURL}` : ''}`)
    if (m.designer) lines.push(`- Designer: ${m.designer}${m.designerURL ? ` — ${m.designerURL}` : ''}`)
    if (m.url) lines.push(`- Source: ${m.url}`)
    if (!m.license && !m.designer && !m.url) lines.push('- No licence metadata recorded for this set.')
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * The downloadable package. Mirrors IcoMoon's zip so switching tools is a no-op,
 * and adds `codepoints.lock` + `ATTRIBUTION.md`, which IcoMoon has no equivalent of.
 */
export async function buildBundle(project: Project, opts: BundleOptions = {}): Promise<{ files: BundleFile[]; build: FontBuild }> {
  const build = await buildFont(project, opts)
  const family = project.preferences.font.family
  const files: BundleFile[] = []

  const dir = opts.embed ? '' : (opts.fontPath ?? 'fonts/')
  if (!opts.embed) {
    if (build.woff2) files.push({ path: `${dir}${family}.woff2`, data: build.woff2 })
    if (build.woff) files.push({ path: `${dir}${family}.woff`, data: build.woff })
    if (build.ttf) files.push({ path: `${dir}${family}.ttf`, data: build.ttf })
    if (!opts.formats || opts.formats.includes('svg')) files.push({ path: `${dir}${family}.svg`, data: build.svg })
  }

  files.push({ path: 'style.css', data: buildCss(project, build, opts) })
  if (opts.includeVariables !== false && project.preferences.font.cssVars) {
    const format = project.preferences.font.cssVarsFormat
    if (format === 'scss' || format === 'less') {
      files.push({ path: `variables.${format}`, data: buildVariables(project, build, format) })
    }
  }
  if (opts.includeDemo !== false) files.push({ path: 'demo.html', data: buildDemoHtml(project, build) })
  if (opts.includeLock !== false) files.push({ path: 'codepoints.lock', data: serializeLock(project) })
  if (opts.includeAttribution !== false) files.push({ path: 'ATTRIBUTION.md', data: buildAttribution(project) })
  if (opts.selectionJson) files.push({ path: 'selection.json', data: opts.selectionJson })

  return { files, build }
}

export { groupIcons }
