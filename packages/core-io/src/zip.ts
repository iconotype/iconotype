import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import type { Bytes } from '@glyphsmith/core-host'
import { importIcoMoon, type ImportResult } from './icomoon-import.js'
import { importSvg, type SvgImportResult } from './svg-import.js'
import type { Glyph } from '@glyphsmith/core-model'

export interface ZipEntry { path: string; data: Uint8Array }

export const readZip = (data: Uint8Array): ZipEntry[] =>
  Object.entries(unzipSync(data)).map(([path, bytes]) => ({ path, data: bytes }))

/**
 * The zip epoch (1980-01-01). fflate defaults every entry's mtime to Date.now(), which
 * makes two identical builds differ — the same trap svg2ttf's `ts` option avoids for the
 * font itself. Reproducible packages are the whole point of `glyphsmith build` in CI.
 */
export const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1))

export const writeZip = (
  entries: Array<{ path: string; data: Uint8Array | string }>,
  opts: { mtime?: Date | number } = {},
): Bytes => {
  const files: Record<string, Uint8Array> = {}
  for (const e of entries) files[e.path] = typeof e.data === 'string' ? strToU8(e.data) : e.data
  return zipSync(files, { mtime: opts.mtime ?? ZIP_EPOCH }) as Bytes
}

/**
 * An IcoMoon download zip: fonts + style.css + demo.html + selection.json.
 * Only selection.json carries the project, so that is what we read.
 */
export function importIcoMoonZip(data: Uint8Array, opts: { projectId?: string } = {}): ImportResult {
  const entries = readZip(data)
  const selection = entries.find((e) => /(^|\/)selection\.json$/i.test(e.path))
  if (!selection) {
    throw new Error(
      `no selection.json in the zip (found: ${entries.map((e) => e.path).slice(0, 8).join(', ')}). ` +
        'Download the font package from IcoMoon rather than the SVG-only archive.',
    )
  }
  return importIcoMoon(JSON.parse(strFromU8(selection.data)), opts)
}

/** A folder or zip of loose SVGs. Findings are kept per glyph, not just flattened. */
export function importSvgZip(
  data: Uint8Array, opts: { targetHeight?: number } = {},
): { results: SvgImportResult[]; glyphs: Glyph[]; warnings: string[] } {
  const results: SvgImportResult[] = []
  const warnings: string[] = []
  for (const entry of readZip(data)) {
    if (!/\.svg$/i.test(entry.path) || /(^|\/)__MACOSX\//.test(entry.path)) continue
    const name = entry.path.split('/').pop()!
    try {
      const result = importSvg(strFromU8(entry.data), name, opts)
      results.push(result)
      warnings.push(...result.warnings.map((w) => `${name}: ${w}`))
    } catch (e) {
      // importSvg errors already carry the filename
      warnings.push((e as Error).message)
    }
  }
  if (!results.length) warnings.push('no .svg files found in the archive')
  return { results, glyphs: results.map((r) => r.glyph), warnings }
}
