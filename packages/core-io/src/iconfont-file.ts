import {
  defaultPreferences, emptySet,
  type Glyph, type IconSet, type OutputConfig, type Project,
} from '@iconotype/core-model'

/**
 * The `.iconotype.json` project file.
 *
 * One committed file per icon font. It holds the artwork, the codepoints AND where a
 * build writes its output, so the editor, the CLI and CI all agree without a second
 * config. Deliberately flat and stable: this file lands in pull requests, so a one-icon
 * change should be a one-hunk diff.
 */
export const ICONFONT_EXTENSION = '.iconotype.json'
export const ICONFONT_SCHEMA_VERSION = 1

export interface IconFontIcon {
  name: string
  /** hex, without the U+ */
  code: string
  /** additional codepoints, for a multicolor icon's extra layers */
  codes?: string[]
  /** false excludes it from the built font but keeps the artwork */
  selected?: boolean
  tags?: string[]
  /** ligature aliases */
  ligatures?: string[]
  /** source grid the artwork was drawn on; 0 means none */
  grid?: number
  /** advance width in coordinate units; absent means square */
  width?: number
  paths: string[]
  /** per-layer paint, parallel to paths; only present for multicolor icons */
  colors?: string[]
  source?: { url?: string; license?: string; author?: string; importedFrom?: string }
}

export interface IconFontFile {
  $schema?: string
  schemaVersion: number
  /** identifies the font: family name, class prefix root, autocomplete trigger */
  name: string
  font: {
    family: string
    /** may interpolate `${i}` (glyph index) and `${u}` (codepoint hex), as IcoMoon does */
    prefix: string
  /** prefixes the code writes, when a build step rewrites them */
  usagePrefixes?: string[]
    postfix?: string
    /** output em size */
    emSize: number
    /** descender as a percentage of the em */
    baseline: number
    /** space advance as a percentage of the em */
    whitespace: number
    version: string
    /** `.icon-home:before { content }` — on by default */
    classPerGlyph?: boolean
    /** `--icon-home: "\e900"` on :root */
    propertyPerGlyph?: boolean
    /** human-readable names in the font's post table — on by default */
    glyphNames?: boolean
    /** class prefix for multicolor palettes */
    palettePrefix?: string
    /** emit a rule set for every colour palette */
    allColorPalettes?: boolean
    /** written into the font's name table */
    metadata?: {
      copyright?: string
      designer?: string
      designerURL?: string
      license?: string
      licenseURL?: string
      description?: string
      url?: string
    }
  }
  /** coordinate space the paths are expressed in */
  height: number
  output?: OutputConfig
  icons: IconFontIcon[]
  /** licence/attribution metadata for the artwork's origin */
  credits?: Array<{ name: string; license?: string; licenseURL?: string; designer?: string; url?: string }>
}

const toHex = (code: number): string => code.toString(16)
const fromHex = (code: string): number => parseInt(code.replace(/^(u\+|0x)/i, ''), 16)

/** Project → file. Icons are sorted by codepoint so the diff of a rebuild is empty. */
export function toIconFontFile(project: Project): IconFontFile {
  const prefs = project.preferences.font
  const height = project.sets[0]?.height ?? 1024

  const icons: IconFontIcon[] = []
  for (const set of project.sets) {
    if (set.hidden) continue
    for (const glyph of set.glyphs) {
      const cp = project.codepoints[glyph.name]
      const codes = cp === undefined ? [] : Array.isArray(cp) ? cp : [cp]
      icons.push({
        name: glyph.name,
        code: toHex(codes[0] ?? 0),
        ...(codes.length > 1 ? { codes: codes.slice(1).map(toHex) } : {}),
        ...(glyph.selected === false ? { selected: false } : {}),
        ...(glyph.tags.length && glyph.tags.join() !== glyph.name ? { tags: glyph.tags } : {}),
        ...(glyph.aliases.length ? { ligatures: glyph.aliases } : {}),
        ...(glyph.grid ? { grid: glyph.grid } : {}),
        ...(glyph.advanceWidth !== undefined ? { width: glyph.advanceWidth } : {}),
        paths: glyph.paths,
        ...(glyph.isMulticolor ? { colors: glyph.attrs.map((a) => a.fill ?? '') } : {}),
        ...(glyph.source && Object.keys(glyph.source).length ? { source: glyph.source } : {}),
      })
    }
  }
  icons.sort((a, b) => fromHex(a.code) - fromHex(b.code) || a.name.localeCompare(b.name))

  /**
   * Credits the project is carrying, plus any a set adds that they do not cover.
   *
   * The project's list comes first because reading this file collapses everything into
   * one set named after the FONT, and that set inherits the first credit — so trusting
   * the sets would rewrite "Lucide — ISC" as "demo — ISC" on every round trip and drop
   * the other two licences entirely. Sets still contribute, which is how a collection
   * added in the app gets its first credit.
   */
  const fromSets = project.sets
    .filter((s) => s.metadata.license || s.metadata.designer || s.metadata.url)
    .map((s) => ({
      name: s.name,
      ...(s.metadata.license ? { license: s.metadata.license } : {}),
      ...(s.metadata.licenseURL ? { licenseURL: s.metadata.licenseURL } : {}),
      ...(s.metadata.designer ? { designer: s.metadata.designer } : {}),
      ...(s.metadata.url ? { url: s.metadata.url } : {}),
    }))
  const carried = project.credits ?? []
  const known = new Set(carried.map((c) => `${c.designer ?? ''}|${c.license ?? ''}`))
  const credits = [...carried, ...fromSets.filter((c) => !known.has(`${c.designer ?? ''}|${c.license ?? ''}`))]

  return {
    $schema: 'https://iconotype.dev/schema/iconfont-1.json',
    schemaVersion: ICONFONT_SCHEMA_VERSION,
    name: prefs.family,
    font: {
      family: prefs.family,
      prefix: prefs.prefix,
    ...(prefs.usagePrefixes?.length ? { usagePrefixes: [...prefs.usagePrefixes] } : {}),
      ...(prefs.postfix ? { postfix: prefs.postfix } : {}),
      emSize: prefs.emSize,
      baseline: prefs.baselinePct,
      whitespace: prefs.whitespacePct,
      version: `${prefs.majorVersion}.${prefs.minorVersion}`,
      // only non-default switches are written, so the file stays quiet
      ...(prefs.classPerGlyph === false ? { classPerGlyph: false } : {}),
      ...(prefs.propertyPerGlyph ? { propertyPerGlyph: true } : {}),
      ...(prefs.glyphNamesInFont === false ? { glyphNames: false } : {}),
      ...(prefs.palettePrefix && prefs.palettePrefix !== 'palette' ? { palettePrefix: prefs.palettePrefix } : {}),
      ...(prefs.allColorPalettes ? { allColorPalettes: true } : {}),
      ...(prefs.metadata && Object.keys(prefs.metadata).length ? { metadata: prefs.metadata } : {}),
    },
    height,
    ...(project.output ? { output: project.output } : {}),
    icons,
    ...(credits.length ? { credits } : {}),
  }
}

/** File → project. */
export function fromIconFontFile(file: IconFontFile, id = 'p0'): Project {
  if (file.schemaVersion > ICONFONT_SCHEMA_VERSION) {
    throw new Error(
      `this project needs a newer Iconotype: file schemaVersion ${file.schemaVersion}, this build understands ${ICONFONT_SCHEMA_VERSION}`,
    )
  }
  const prefs = defaultPreferences()
  const [major = 1, minor = 0] = (file.font?.version ?? '1.0').split('.').map(Number)
  prefs.font = {
    ...prefs.font,
    family: file.font?.family ?? file.name,
    prefix: file.font?.prefix ?? 'icon-',
    ...(file.font?.usagePrefixes?.length ? { usagePrefixes: [...file.font.usagePrefixes] } : {}),
    postfix: file.font?.postfix ?? '',
    emSize: file.font?.emSize ?? 1024,
    baselinePct: file.font?.baseline ?? 6.25,
    whitespacePct: file.font?.whitespace ?? 50,
    majorVersion: major,
    minorVersion: minor,
    classPerGlyph: file.font?.classPerGlyph ?? true,
    propertyPerGlyph: file.font?.propertyPerGlyph ?? false,
    glyphNamesInFont: file.font?.glyphNames ?? true,
    palettePrefix: file.font?.palettePrefix ?? 'palette',
    allColorPalettes: file.font?.allColorPalettes ?? false,
    ...(file.font?.metadata ? { metadata: file.font.metadata } : {}),
  }

  const codepoints: Project['codepoints'] = {}
  const glyphs: Glyph[] = (file.icons ?? []).map((icon, index) => {
    const codes = [fromHex(icon.code), ...(icon.codes ?? []).map(fromHex)]
    codepoints[icon.name] = codes.length > 1 ? codes : codes[0]!
    const colors = icon.colors ?? []
    return {
      id: `${id}:${icon.name}`,
      name: icon.name,
      aliases: icon.ligatures ?? [],
      tags: icon.tags ?? [icon.name],
      paths: icon.paths,
      attrs: icon.paths.map((_, i): Record<string, string> => (colors[i] ? { fill: colors[i]! } : {})),
      grid: icon.grid ?? 0,
      isMulticolor: colors.length > 1,
      ...(icon.width !== undefined ? { advanceWidth: icon.width } : {}),
      ...(icon.selected === false ? { selected: false } : {}),
      ...(icon.source ? { source: icon.source } : {}),
      foreign: { order: index },
    }
  })

  const set: IconSet = {
    ...emptySet(`${id}-set-0`, file.name),
    height: file.height ?? 1024,
    glyphs,
  }
  const credit = file.credits?.[0]
  if (credit) {
    set.metadata = {
      license: credit.license,
      licenseURL: credit.licenseURL,
      designer: credit.designer,
      url: credit.url,
    }
  }

  return {
    schemaVersion: 1,
    id,
    name: file.name,
    createdAt: 0,
    sets: [set],
    preferences: prefs,
    codepoints,
    ...(file.output ? { output: file.output } : {}),
    // every credit, not just the one the single set could hold
    ...(file.credits?.length ? { credits: file.credits.map((c) => ({ ...c })) } : {}),
  }
}

export const serializeIconFont = (project: Project): string =>
  JSON.stringify(toIconFontFile(project), null, 2) + '\n'

export function parseIconFont(text: string, id?: string): Project {
  const data = JSON.parse(text) as IconFontFile
  if (typeof data?.schemaVersion !== 'number' || !Array.isArray(data.icons)) {
    throw new Error('not a Iconotype icon font file (expected schemaVersion and icons)')
  }
  return fromIconFontFile(data, id)
}

export const isIconFontFile = (data: unknown): data is IconFontFile =>
  typeof data === 'object' && data !== null &&
  typeof (data as IconFontFile).schemaVersion === 'number' &&
  Array.isArray((data as IconFontFile).icons)

/** Only the glyphs a build should include. */
export const selectedGlyphs = (project: Project): Glyph[] =>
  project.sets.filter((s) => !s.hidden).flatMap((s) => s.glyphs).filter((g) => g.selected !== false)
