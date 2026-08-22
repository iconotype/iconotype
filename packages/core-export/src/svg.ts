import type { Glyph, IconSet, Project } from '@glyphsmith/core-model'
import { finish, indent, resolveFormat, xmlEscape, type FormatOptions } from './options.js'

export interface IconEntry { glyph: Glyph; set: IconSet }

export const iconsOf = (project: Project, ids?: Set<string>): IconEntry[] =>
  project.sets
    .filter((set) => !set.hidden)
    .flatMap((set) => set.glyphs.map((glyph) => ({ glyph, set })))
    .filter(({ glyph }) => !ids || ids.has(glyph.id))

const sizeAttrs = (opts: ReturnType<typeof resolveFormat>) =>
  opts.fixedSize ? ` width="${opts.size}" height="${opts.size}"` : ''

const pathsOf = (glyph: Glyph, colored: boolean): string =>
  glyph.paths
    .map((d, i) => {
      const fill = colored && glyph.attrs[i]?.fill ? ` fill="${xmlEscape(glyph.attrs[i]!.fill!)}"` : ''
      return `<path${fill} d="${d}"/>`
    })
    .join('')

/** A single standalone SVG file for one glyph. */
export function exportSvg(entry: IconEntry, options: FormatOptions = {}): string {
  const opts = resolveFormat(options)
  const { glyph, set } = entry
  const title = opts.addTitle ? `\n${indent(1, opts)}<title>${xmlEscape(glyph.name)}</title>` : ''
  const body = glyph.paths
    .map((d, i) => {
      const fill = glyph.attrs[i]?.fill ? ` fill="${xmlEscape(glyph.attrs[i]!.fill!)}"` : ''
      return `\n${indent(1, opts)}<path${fill} d="${d}"/>`
    })
    .join('')
  return finish(
    `<svg xmlns="http://www.w3.org/2000/svg"${sizeAttrs(opts)} viewBox="0 0 ${set.height} ${set.height}">${title}${body}\n</svg>\n`,
    opts,
  )
}

/**
 * One sprite sheet of `<symbol>` definitions. Referenced with
 * `<svg><use href="#icon-home"/></svg>`, which keeps colour and size in CSS.
 */
export function exportSpriteSymbols(project: Project, entries: IconEntry[], options: FormatOptions = {}): string {
  const opts = resolveFormat(options)
  const symbols = entries.map(({ glyph, set }) => {
    const id = `${opts.prependNamesToIds ? opts.prefix : ''}${glyph.name}${opts.postfix}`
    const title = opts.addTitle ? `<title>${xmlEscape(glyph.name)}</title>` : ''
    return `${indent(1, opts)}<symbol id="${xmlEscape(id)}" viewBox="0 0 ${set.height} ${set.height}">${title}${pathsOf(glyph, true)}</symbol>`
  })
  return finish(
    `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join('\n')}\n</svg>\n`,
    opts,
  )
}

/** The markup a consumer pastes to reference a sprite symbol. */
export function exportUseSnippet(glyph: Glyph, options: FormatOptions = {}): string {
  const opts = resolveFormat(options)
  const id = `${opts.prependNamesToIds ? opts.prefix : ''}${glyph.name}${opts.postfix}`
  return finish(`<svg${sizeAttrs(opts)}><use href="#${xmlEscape(id)}"/></svg>`, opts)
}

/** Inline `<symbol>` for one glyph, for pasting into an existing sheet. */
export function exportSymbolSnippet(entry: IconEntry, options: FormatOptions = {}): string {
  const opts = resolveFormat(options)
  const id = `${opts.prependNamesToIds ? opts.prefix : ''}${entry.glyph.name}${opts.postfix}`
  return finish(
    `<symbol id="${xmlEscape(id)}" viewBox="0 0 ${entry.set.height} ${entry.set.height}">${pathsOf(entry.glyph, true)}</symbol>`,
    opts,
  )
}

/** `data:image/svg+xml,...` — usable directly in CSS `url()` or an `<img src>`. */
export function exportDataUri(entry: IconEntry, options: FormatOptions = {}): string {
  const svg = exportSvg(entry, { ...options, removeNewlines: true })
  return `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')}`
}

/** The literal character a glyph is mapped to, for pasting into markup. */
export function exportCharacter(project: Project, glyph: Glyph): string {
  const cp = project.codepoints[glyph.name]
  if (cp === undefined) return ''
  return (Array.isArray(cp) ? cp : [cp]).map((c) => String.fromCodePoint(c)).join('')
}

/** The CSS escape for a codepoint, e.g. `\e900`. */
export function exportEscape(project: Project, glyph: Glyph): string {
  const cp = project.codepoints[glyph.name]
  if (cp === undefined) return ''
  return (Array.isArray(cp) ? cp : [cp]).map((c) => `\\${c.toString(16)}`).join('')
}
