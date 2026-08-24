import type { OutputConfig, Project, StyleOutputKind } from '@iconotype/core-model'
import { asPaths } from '@iconotype/core-model'

/**
 * Paths, names and fingerprints — everything about an export that can be decided
 * without building a font.
 *
 * Kept clear of core-font on purpose: the VSCode extension needs all of this at
 * activation (to know where output goes and whether it is current), and importing it
 * used to drag svg2ttf, the WOFF2 encoder and paper.js into the activation path.
 */

const dirOf = (path: string): string => path.replace(/\/+$/, '').split('/').slice(0, -1).join('/')
export const clean = (path: string): string => path.replace(/^\.\//, '').replace(/\/+/g, '/')

export interface OutputLayout {
  /** font family name; also the stylesheet's basename */
  name: string
  fontsDir?: string
  stylesDir?: string
  styleKind?: StyleOutputKind
  formats?: NonNullable<OutputConfig['fonts']>['formats']
  /** path for a generated .d.ts, if wanted */
  typesPath?: string
}

/** The file extension a style output kind is written with. */
export const styleExtension = (kind: StyleOutputKind): string =>
  kind.startsWith('scss') ? 'scss'
  : kind.startsWith('less') ? 'less'
  : kind === 'json' ? 'json'
  : kind === 'dart' ? 'dart'
  : 'css'

/**
 * The stylesheet's filename. An scss file holding only variables is written as a
 * partial (`_app.scss`), because that is what every scss codebase expects: sass
 * refuses to compile a non-partial to its own css file without complaint.
 */
export const styleFileName = (name: string, kind: StyleOutputKind): string => {
  const extension = styleExtension(kind)
  return extension === 'scss' && kind.endsWith('variables') ? `_${name}.scss` : `${name}.${extension}`
}

/**
 * Builds an `output` block from a plain directory layout.
 *
 * Shared by the CLI's `init`, the extension's import wizard and its settings fallback,
 * so all three produce byte-identical configuration for the same answers.
 */
export function outputConfigFor(opts: OutputLayout): OutputConfig {
  const kind = opts.styleKind ?? 'css'
  const stylesDir = (opts.stylesDir ?? 'css').replace(/\/+$/, '')
  return {
    fonts: {
      dir: (opts.fontsDir ?? 'fonts').replace(/\/+$/, ''),
      formats: opts.formats ?? ['woff2', 'woff', 'ttf'],
    },
    styles: [{ kind, path: `${stylesDir ? `${stylesDir}/` : ''}${styleFileName(opts.name, kind)}` }],
    ...(opts.typesPath ? { types: { path: opts.typesPath } } : {}),
  }
}

/**
 * The `url()` a stylesheet should use to reach the fonts directory.
 *
 * Fonts and stylesheets usually live in different folders — `app/fonts` and `app/css`
 * in a typical webpack layout — so a literal path from the project root would be wrong
 * inside the stylesheet. This walks up from the stylesheet and back down to the fonts.
 */
export function relativeFontPath(stylePath: string, fontsDir: string): string {
  const from = clean(dirOf(stylePath)).split('/').filter(Boolean)
  const to = clean(fontsDir).split('/').filter(Boolean)
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++
  const up = '../'.repeat(from.length - shared)
  const down = to.slice(shared).join('/')
  const joined = `${up}${down}`.replace(/\/+/g, '/')
  return joined === '' ? './' : joined.endsWith('/') ? joined : `${joined}/`
}

/** A sensible starting configuration for a project that has none. */
export const defaultOutputConfig = (family: string): OutputConfig => ({
  fonts: { dir: 'fonts', formats: ['woff2', 'woff', 'ttf'] },
  styles: [{ kind: 'css', path: `css/${family}.css` }],
})

// ── staleness ────────────────────────────────────────────────────────────────────

/**
 * A short, stable fingerprint of everything that changes a build's output.
 *
 * Comparing file timestamps cannot answer "do the generated files still match the
 * project?": an export that writes identical bytes deliberately touches nothing, so
 * mtimes would report stale forever. Comparing rebuilt bytes answers it exactly but
 * costs a full font build. This is the cheap middle: hash the inputs, and only the
 * inputs — a tag or a note changing must NOT mark a font as needing an export.
 */
export function buildStamp(project: Project): string {
  const font = project.preferences.font
  const canonical = JSON.stringify([
    font.family, font.prefix, font.postfix, font.emSize, font.baselinePct, font.whitespacePct,
    font.majorVersion, font.minorVersion, font.classPerGlyph, font.propertyPerGlyph,
    font.glyphNamesInFont, font.palettePrefix, font.allColorPalettes, font.metadata ?? null,
    project.output ?? null,
    project.sets
      .filter((set) => !set.hidden)
      .map((set) => [
        set.height,
        set.glyphs
          .filter((glyph) => glyph.selected !== false)
          .map((glyph) => [
            glyph.name,
            glyph.paths,
            glyph.attrs.map((a) => a?.fill ?? ''),
            glyph.isMulticolor,
            glyph.advanceWidth ?? null,
            glyph.aliases,
            project.codepoints[glyph.name] ?? null,
          ]),
      ]),
  ])

  // FNV-1a, 64 bits as two 32-bit halves: no crypto dependency, and this only has to
  // detect change, not resist anyone
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ ((c << 5) | (c >>> 3)), 0x85ebca6b)
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'))
}

/**
 * Every workspace-relative path a build of this project writes.
 *
 * One output can name several destinations, so this is a flat list of all of them —
 * callers use it to watch, to clean, or to tell whether a file on disk is generated,
 * and every copy has to answer yes to that last question.
 */
export function outputPaths(project: Project): string[] {
  const output = project.output
  if (!output) return []
  const family = project.preferences.font.family
  const dirs = asPaths(output.fonts?.dir).map((dir) => clean(dir).replace(/\/?$/, '/'))
  return [
    ...dirs.flatMap((dir) => (output.fonts?.formats ?? []).map((format) => `${dir}${family}.${format}`)),
    ...(output.styles ?? []).flatMap((style) => asPaths(style.path).map(clean)),
    ...asPaths(output.types?.path).map(clean),
    ...asPaths(output.sprite?.path).map(clean),
    ...asPaths(output.demo?.path).map(clean),
  ]
}
