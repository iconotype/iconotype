/**
 * Recognising an older icon-font project, and nothing else.
 *
 * Deliberately its own module with no imports: the VS Code extension has to sniff a
 * file the moment someone opens one, and the importer next door reaches the SVG
 * pipeline — paper.js and all — which must stay in the deferred half of the bundle.
 * Detection is a shape check; it has no business dragging 2.5 MB in with it.
 */
export interface SvgNodeGlyph {
  extras?: { name?: string; codePoint?: number }
  node?: unknown
  palettes?: unknown
}

export interface SvgNodeProjectFile {
  glyphs: SvgNodeGlyph[]
  formats?: unknown[]
  palettes?: unknown
}

export function isSvgNodeProject(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const file = data as SvgNodeProjectFile
  if (!Array.isArray(file.glyphs)) return false
  // an empty project is still one, as long as it carries the surrounding blocks
  if (file.glyphs.length === 0) return Array.isArray(file.formats)
  return file.glyphs.every((g) =>
    Boolean(g) && typeof g === 'object' &&
    Boolean((g as SvgNodeGlyph).node) &&
    typeof ((g as SvgNodeGlyph).node as { tag?: unknown })?.tag === 'string')
}
