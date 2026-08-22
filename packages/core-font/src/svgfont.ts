import svgpath from 'svgpath'
import type { Glyph, IconSet, Project } from '@glyphsmith/core-model'
import { advanceFor, metricsFrom, svgToFontMatrix, type FontMetrics } from './metrics.js'

export interface BuiltGlyph {
  name: string
  /** codepoint for this layer */
  code: number
  /** 0 for monochrome; 1-based layer index for multicolor */
  layer: number
  layerCount: number
  /** ligature sequences that resolve to this glyph */
  ligatures: string[]
  color?: string
  advanceWidth: number
  pathData: string
}

export interface BuildWarning { code: string; message: string }

export interface SvgFontResult {
  svg: string
  glyphs: BuiltGlyph[]
  metrics: FontMetrics
  warnings: BuildWarning[]
  /** characters that had to be added as blanks so ligatures can trigger */
  ligatureChars: string[]
}

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Every character becomes a numeric entity: safe for PUA, ligatures and quotes alike. */
const unicodeAttr = (s: string): string =>
  [...s].map((c) => `&#x${c.codePointAt(0)!.toString(16)};`).join('')

function codesFor(project: Project, glyph: Glyph): number[] | null {
  const cp = project.codepoints[glyph.name]
  if (cp === undefined) return null
  return Array.isArray(cp) ? cp : [cp]
}

/**
 * Project → SVG font.
 *
 * This is both an export format in its own right and the input to svg2ttf. Building the
 * font from a text format keeps one source of truth for metrics and makes the output
 * inspectable when a glyph comes out wrong.
 */
export function buildSvgFont(project: Project): SvgFontResult {
  const metrics = metricsFrom(project.preferences.font)
  const warnings: BuildWarning[] = []
  const glyphs: BuiltGlyph[] = []
  const seenCodes = new Map<number, string>()

  const emit = (set: IconSet, glyph: Glyph) => {
    const codes = codesFor(project, glyph)
    if (!codes) {
      warnings.push({ code: 'NO_CODEPOINT', message: `"${glyph.name}" has no codepoint and was skipped` })
      return
    }
    const matrix = svgToFontMatrix(set.height, metrics)
    const advanceWidth = advanceFor(glyph.advanceWidth, set.height, metrics)

    /**
     * `paths[]` is NOT one entry per colour. A monochrome glyph routinely has several
     * entries — they are subpaths of one shape and share a single codepoint (in the
     * alpimaps fixture, `mountaineering` has six). Only `isMulticolor` promotes each
     * entry to its own glyph and codepoint, which is IcoMoon's layer model.
     */
    const layers = glyph.isMulticolor
      ? glyph.paths.map((d) => [d])
      : [glyph.paths]
    const layerCount = layers.length

    if (codes.length < layerCount) {
      warnings.push({
        code: 'MISSING_LAYER_CODES',
        message: `"${glyph.name}" has ${layerCount} colour layers but only ${codes.length} codepoint(s); extra layers dropped`,
      })
    }

    layers.slice(0, codes.length).forEach((subpaths, i) => {
      const code = codes[i]!
      const clash = seenCodes.get(code)
      if (clash) {
        warnings.push({ code: 'DUPLICATE_CODEPOINT', message: `U+${code.toString(16)} used by both "${clash}" and "${glyph.name}"` })
      }
      seenCodes.set(code, glyph.name)
      glyphs.push({
        name: layerCount > 1 ? `${glyph.name}-path${i + 1}` : glyph.name,
        code,
        layer: layerCount > 1 ? i + 1 : 0,
        layerCount,
        ligatures: i === 0 ? glyph.aliases : [],
        color: glyph.attrs[i]?.fill,
        advanceWidth,
        pathData: subpaths
          .map((d) => svgpath(d).matrix(matrix).abs().unshort().unarc().round(1).toString())
          .join(''),
      })
    })
  }

  for (const set of project.sets) {
    if (set.hidden) continue
    // `selected: false` keeps the artwork in the project but out of the font
    for (const glyph of set.glyphs) if (glyph.selected !== false) emit(set, glyph)
  }
  glyphs.sort((a, b) => a.code - b.code)

  // Ligatures substitute a run of characters, so those characters must exist in the
  // font or the rule can never fire. They are emitted blank and zero-width.
  const ligatureChars = [...new Set(glyphs.flatMap((g) => g.ligatures).flatMap((l) => [...l]))].sort()
  if (ligatureChars.length) {
    warnings.push({
      code: 'LIGATURE_BLANKS',
      message: `${ligatureChars.length} blank character glyph(s) added so ligatures can trigger (${ligatureChars.join('')})`,
    })
  }

  const space = Math.round((metrics.unitsPerEm * project.preferences.font.whitespacePct) / 100)
  const family = project.preferences.font.family

  const lines: string[] = [
    '<?xml version="1.0" standalone="no"?>',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<defs>',
    `<font id="${xml(family)}" horiz-adv-x="${metrics.unitsPerEm}">`,
    `<font-face font-family="${xml(family)}" font-weight="400" font-stretch="normal" units-per-em="${metrics.unitsPerEm}" ascent="${metrics.ascender}" descent="${metrics.descender}" />`,
    `<missing-glyph horiz-adv-x="${metrics.unitsPerEm}" />`,
    `<glyph unicode="&#x20;" glyph-name="space" horiz-adv-x="${space}" d="" />`,   // eslint-disable-line
  ]
  for (const c of ligatureChars) {
    lines.push(`<glyph unicode="${unicodeAttr(c)}" glyph-name="ligature-${c.codePointAt(0)!.toString(16)}" horiz-adv-x="0" d="" />`)
  }
  // glyph names land in the font's `post` table. They make a font inspectable, and
  // cost a little size; IcoMoon exposes the same switch.
  const named = project.preferences.font.glyphNamesInFont !== false
  const nameAttr = (name: string) => (named ? ` glyph-name="${xml(name)}"` : '')

  for (const g of glyphs) {
    lines.push(
      `<glyph unicode="${unicodeAttr(String.fromCodePoint(g.code))}"${nameAttr(g.name)} horiz-adv-x="${g.advanceWidth}" d="${xml(g.pathData)}" />`,
    )
    for (const liga of g.ligatures) {
      lines.push(
        `<glyph unicode="${unicodeAttr(liga)}"${nameAttr(`${g.name}-liga-${liga}`)} horiz-adv-x="${g.advanceWidth}" d="${xml(g.pathData)}" />`,
      )
    }
  }
  lines.push('</font>', '</defs>', '</svg>')

  return { svg: lines.join('\n'), glyphs, metrics, warnings, ligatureChars }
}
