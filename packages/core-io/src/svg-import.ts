import { fixSvg, type FixOptions, type Finding } from '@iconotype/core-svg'
import type { Glyph } from '@iconotype/core-model'

export interface SvgImportOptions extends FixOptions {
  /** source grid recorded on the glyph (0 = none) */
  grid?: number
}

export interface SvgImportResult {
  glyph: Glyph
  warnings: string[]
  findings: Finding[]
}

/** CSS-safe, ligature-safe glyph name derived from a filename. */
export const glyphNameFrom = (filename: string): string =>
  filename
    .replace(/\.svg$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

/**
 * SVG file to glyph. All the work happens in @iconotype/core-svg's pipeline
 * (docs/04); this just names the result and shapes it as a Glyph.
 */
export function importSvg(source: string, name: string, opts: SvgImportOptions = {}): SvgImportResult {
  let result
  try {
    result = fixSvg(source, opts)
  } catch (e) {
    throw new Error(`${name}: ${(e as Error).message}`)
  }
  return {
    findings: result.findings,
    warnings: result.findings
      .filter((f) => f.severity !== 'info')
      .map((f) => `${f.code}: ${f.message}`),
    glyph: {
      id: `svg:${name}`,
      name: glyphNameFrom(name),
      aliases: [],
      tags: [name.replace(/\.svg$/i, '')],
      paths: result.paths,
      attrs: result.attrs,
      grid: opts.grid ?? 0,
      isMulticolor: result.isMulticolor,
      source: { importedFrom: name },
    },
  }
}
