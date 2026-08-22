import type { Glyph, IconSet, Preferences, Project } from '@iconotype/core-model'
import { rebuild, reorderByOriginalIndex, type Preserved } from './preserve.js'
import type {
  IcoMoonIcon, IcoMoonPreferences, IcoMoonProjectFile, IcoMoonSelectionEntry,
  IcoMoonSelectionFile, IcoMoonSet,
} from './icomoon-types.js'

const pres = (holder: { foreign?: Record<string, unknown> } | undefined, key: string): Preserved | undefined =>
  holder?.foreign?.[key] as Preserved | undefined

const indexOf = (holder: { foreign?: Record<string, unknown> }, key: string): number | undefined =>
  pres(holder, key)?.index

/**
 * `index` is the fallback id. IcoMoon joins icons[] to selection[] BY ID, so glyphs that
 * did not come from IcoMoon (an SVG import, say) must still get distinct ids — emitting
 * 0 for all of them collapses every glyph onto one selection entry on re-import.
 */
function toIcon(glyph: Glyph, index: number): IcoMoonIcon {
  return rebuild(pres(glyph, 'icon'), {
    id: (glyph.foreign?.icoMoonId as number) ?? index,
    paths: [...glyph.paths],
    attrs: glyph.attrs.map((a) => ({ ...a })),
    width: glyph.advanceWidth,
    isMulticolor: glyph.isMulticolor && !(glyph.foreign?.isMulticolor2 as boolean),
    isMulticolor2: Boolean(glyph.foreign?.isMulticolor2),
    tags: [...glyph.tags],
    grid: glyph.grid,
  }) as unknown as IcoMoonIcon
}

function toSelectionEntry(glyph: Glyph, index: number, codepoints: Project['codepoints']): IcoMoonSelectionEntry {
  const cp = codepoints[glyph.name]
  const codes = Array.isArray(cp) ? cp : undefined
  return rebuild(pres(glyph, 'selection'), {
    order: (glyph.foreign?.order as number) ?? index + 1,
    id: (glyph.foreign?.icoMoonId as number) ?? index,
    name: glyph.name,
    prevSize: (glyph.foreign?.prevSize as number) ?? glyph.grid ?? 24,
    code: codes ? codes[0]! : ((cp as number) ?? 0),
    ...(codes ? { codes: [...codes] } : {}),
    ...(glyph.aliases.length ? { ligatures: glyph.aliases.join(', ') } : {}),
  }) as unknown as IcoMoonSelectionEntry
}

function toSet(set: IconSet, codepoints: Project['codepoints']): IcoMoonSet {
  // Restore the source array positions: IcoMoon's icons[]/selection[] are not sorted,
  // and re-sorting them would rewrite the file even though nothing changed.
  const byIcon = reorderByOriginalIndex(set.glyphs, (g) => indexOf(g, 'icon'))
  const bySelection = reorderByOriginalIndex(set.glyphs, (g) => indexOf(g, 'selection'))

  const metadata = rebuild(pres(set, 'metadata'), {
    name: set.name,
    url: set.metadata.url,
    designer: set.metadata.designer,
    designerURL: set.metadata.designerURL,
    license: set.metadata.license,
    licenseURL: set.metadata.licenseURL,
    iconsHash: set.foreign?.iconsHash as number | undefined,
    importSize: set.metadata.importSize,
  })

  return rebuild(pres(set, 'set'), {
    id: (set.foreign?.icoMoonId as number) ?? 0,
    metadata,
    height: set.height,
    prevSize: set.prevSize,
    invisible: set.hidden,
    colorThemes: structuredClone(set.colorThemes),
    colorThemeIdx: set.colorThemeIdx,
    icons: byIcon.map((g, i) => toIcon(g, i)),
    selection: bySelection.map((g, i) => toSelectionEntry(g, i, codepoints)),
  }) as unknown as IcoMoonSet
}

function toPreferences(prefs: Preferences, original: IcoMoonPreferences): IcoMoonPreferences {
  // Merge onto the original so IcoMoon's own keys (and any we do not model) survive.
  const out: IcoMoonPreferences = structuredClone(original)
  out.gridSize = prefs.gridSize
  out.historySize = prefs.historySize
  out.showCodes = prefs.showCodes
  const fp = (out.fontPref ??= {})
  fp.prefix = prefs.font.prefix
  if (prefs.font.postfix) fp.postfix = prefs.font.postfix
  fp.metadata = { ...(fp.metadata ?? {}), fontFamily: prefs.font.family, majorVersion: prefs.font.majorVersion, minorVersion: prefs.font.minorVersion }
  fp.metrics = { ...(fp.metrics ?? {}), emSize: prefs.font.emSize, baseline: prefs.font.baselinePct, whitespace: prefs.font.whitespacePct }
  fp.embed = prefs.font.embed
  fp.cssVars = prefs.font.cssVars
  if (prefs.font.cssVarsFormat !== 'css') fp.cssVarsFormat = prefs.font.cssVarsFormat
  return out
}

/** Shape A — `File → Save`. Byte-identical to the source when nothing was edited. */
export function exportIcoMoonProject(project: Project): IcoMoonProjectFile {
  return rebuild(pres(project, 'project'), {
    metadata: rebuild(pres(project, 'metadata'), {
      name: project.name,
      created: project.createdAt || undefined,
    }),
    iconSets: project.sets.map((s) => toSet(s, project.codepoints)),
    preferences: toPreferences(project.preferences, (project.foreign?.preferences as IcoMoonPreferences) ?? {}),
  }) as unknown as IcoMoonProjectFile
}

/** Shape B — what ships inside a font zip, so users are never locked in. */
export function exportIcoMoonSelection(project: Project): IcoMoonSelectionFile {
  const icons: IcoMoonSelectionFile['icons'] = []
  project.sets.forEach((set, setIdx) => {
    set.glyphs.forEach((glyph, iconIdx) => {
      icons.push({
        icon: toIcon(glyph, iconIdx),
        attrs: glyph.attrs.map((a) => ({ ...a })),
        properties: toSelectionEntry(glyph, iconIdx, project.codepoints),
        setIdx,
        setId: (set.foreign?.icoMoonId as number) ?? setIdx,
        iconIdx,
      })
    })
  })
  return {
    IcoMoonType: 'selection',
    icons,
    height: project.sets[0]?.height ?? 1024,
    metadata: { name: project.preferences.font.family },
    preferences: toPreferences(project.preferences, (project.foreign?.preferences as IcoMoonPreferences) ?? {}),
  }
}
