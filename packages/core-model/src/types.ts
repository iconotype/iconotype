export type GlyphId = string
export type SetId = string

/** A glyph's geometry is always normalized path data in the set's coordinate height. */
export interface Glyph {
  id: GlyphId
  name: string
  /** additional names → ligature aliases */
  aliases: string[]
  tags: string[]
  /** one entry per color layer; single-element for monochrome */
  paths: string[]
  /** parallel to `paths`; `{}` for monochrome */
  attrs: Array<Record<string, string>>
  /** source grid the artwork was drawn on; 0 = none */
  grid: number
  isMulticolor: boolean
  /** advance width in set units; undefined = square (set.height) */
  advanceWidth?: number
  /** unset means selected; only `false` excludes the glyph from the built font */
  selected?: boolean
  source?: { url?: string; license?: string; author?: string; importedFrom?: string }
  /** verbatim foreign fields (e.g. IcoMoon's) so re-export is lossless */
  foreign?: Record<string, unknown>
}

export interface IconSet {
  id: SetId
  name: string
  /** coordinate height the paths are expressed in (IcoMoon uses 1024) */
  height: number
  /** preview size in the grid UI */
  prevSize: number
  /** set disabled in the project (IcoMoon calls this `invisible`) */
  hidden: boolean
  metadata: {
    url?: string
    designer?: string
    designerURL?: string
    license?: string
    licenseURL?: string
    importSize?: { width: number; height: number }
  }
  colorThemes: Array<Array<[number, number, number, number]>>
  colorThemeIdx?: number
  glyphs: Glyph[]
  foreign?: Record<string, unknown>
}

export interface FontMetadata {
  copyright?: string
  designer?: string
  designerURL?: string
  license?: string
  licenseURL?: string
  description?: string
  url?: string
}

export interface FontPrefs {
  family: string
  /**
   * Class prefix. May interpolate `${i}` (glyph index) and `${u}` (codepoint in hex),
   * matching IcoMoon — e.g. a suffix of `-${u}` yields `.icon-home-e900`.
   */
  prefix: string
  /**
   * Extra prefixes the CODE uses, when they differ from the class prefix.
   *
   * A build step often rewrites references on the way in — a webpack alias that maps
   * `alpimaps-hiking` onto the `icon-hiking` class, say. Everything that reads source
   * (completion, usage, diagnostics, rename) has to look for what is written there,
   * not for what the generated stylesheet declares. The first entry is what tooling
   * writes when it inserts a reference.
   */
  usagePrefixes?: string[]
  postfix: string
  majorVersion: number
  minorVersion: number
  /** output font em size; may differ from a set's coordinate height */
  emSize: number
  /** descender as a percentage of em (IcoMoon default 6.25) */
  baselinePct: number
  /** space advance as a percentage of em (IcoMoon default 50) */
  whitespacePct: number
  embed: boolean
  selector: 'class' | 'attribute'
  classSelector: string
  cssVars: boolean
  cssVarsFormat: 'css' | 'scss' | 'less'
  showMetrics: boolean
  showMetadata: boolean
  showVersion: boolean
  /** `.icon-home:before { content: "\e900" }` — the usual way to use an icon font */
  classPerGlyph: boolean
  /** `--icon-home: "\e900"` on :root, for referencing a glyph from your own CSS */
  propertyPerGlyph: boolean
  /** write human-readable names into the font's `post` table; costs a little size */
  glyphNamesInFont: boolean
  /** class prefix for multicolor palettes, e.g. `palette` → `.palette1` */
  palettePrefix: string
  /** emit a rule set for every colour palette, not just the active one */
  allColorPalettes: boolean
  /** copyright, designer and licence, written into the font's name table */
  metadata?: FontMetadata
}

export interface Preferences {
  font: FontPrefs
  gridSize: number
  historySize: number
  showCodes: boolean
  showGlyphNames: boolean
}

/** Where a build writes its files. Committed with the project so CI and the editor agree. */
export type StyleOutputKind =
  | 'css'              // @font-face + one rule per icon
  | 'scss' | 'less'    // the same, in that syntax
  | 'scss-variables'   // $app-home: "\e900";
  | 'less-variables'   // @app-home: "\e900";
  | 'css-variables'    // :root { --app-home: "\e900" }
  | 'json'             // { "home": "e900" }
  | 'dart'             // a Flutter IconData class

export interface StyleOutput {
  kind: StyleOutputKind
  /** workspace-relative file path */
  path: string
}

export interface FontsOutput {
  /** workspace-relative directory the font files are written to */
  dir: string
  formats: Array<'woff2' | 'woff' | 'ttf' | 'svg'>
  /**
   * What the @font-face `src` should point at. Fonts and stylesheets usually live in
   * different folders, so this is computed relative to each stylesheet unless set.
   */
  publicPath?: string
}

export interface OutputConfig {
  fonts?: FontsOutput
  styles?: StyleOutput[]
  /** a .d.ts union of every icon name */
  types?: { path: string }
  sprite?: { path: string }
  demo?: { path: string }
}

/**
 * One line of attribution for artwork in the project.
 *
 * Sets carry this too, and in the app that is where it lives. But the committed
 * `.iconotype.json` is one flat set by design, so a project assembled from three
 * libraries would come back with two of its three licences gone — which for CC BY
 * artwork is not a cosmetic loss. Held on the project, every credit survives the
 * round trip whatever the sets do.
 */
export interface Credit {
  name: string
  license?: string
  licenseURL?: string
  designer?: string
  url?: string
}

export interface Project {
  /** bumped when the on-disk shape changes; migrations key off it */
  schemaVersion: 1
  id: string
  name: string
  createdAt: number
  sets: IconSet[]
  preferences: Preferences
  /** name → codepoint; append-only, mirrors codepoints.lock */
  codepoints: Record<string, number | number[]>
  /** where a build writes its files; absent means "ask me" (the web app downloads a zip) */
  output?: OutputConfig
  /** attribution roll-up; written into the generated stylesheet */
  credits?: Credit[]
  foreign?: Record<string, unknown>
}
