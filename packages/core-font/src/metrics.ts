import type { FontPrefs } from '@glyphsmith/core-model'

export interface FontMetrics {
  unitsPerEm: number
  ascender: number
  /** negative */
  descender: number
}

/** IcoMoon expresses the descender as a percentage of the em (default 6.25). */
export function metricsFrom(prefs: FontPrefs): FontMetrics {
  const unitsPerEm = prefs.emSize
  const descender = -Math.round((unitsPerEm * prefs.baselinePct) / 100)
  return { unitsPerEm, ascender: unitsPerEm + descender, descender }
}

/**
 * SVG is y-down from the top-left; fonts are y-up from the baseline.
 * scale = em / source height, then flip and drop by the ascender.
 */
export function svgToFontMatrix(sourceHeight: number, m: FontMetrics): [number, number, number, number, number, number] {
  const s = m.unitsPerEm / sourceHeight
  return [s, 0, 0, -s, 0, m.ascender]
}

/** Source-space advance → font units. Undefined means "square" (a full em). */
export const advanceFor = (advanceWidth: number | undefined, sourceHeight: number, m: FontMetrics): number =>
  advanceWidth === undefined ? m.unitsPerEm : Math.round((advanceWidth * m.unitsPerEm) / sourceHeight)
