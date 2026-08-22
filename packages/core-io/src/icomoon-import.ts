import {
  defaultPreferences, emptySet,
  type Glyph, type IconSet, type Preferences, type Project,
} from '@iconotype/core-model'
import { capture } from './preserve.js'
import {
  detectIcoMoon,
  type IcoMoonFile, type IcoMoonIcon, type IcoMoonIconSetFile, type IcoMoonPreferences,
  type IcoMoonProjectFile, type IcoMoonSelectionEntry, type IcoMoonSelectionFile, type IcoMoonSet,
} from './icomoon-types.js'

export interface ImportResult {
  project: Project
  warnings: string[]
}

/** Fields we map onto our own model. Everything else is captured verbatim. */
const ICON_KEYS = new Set(['id', 'paths', 'attrs', 'isMulticolor', 'isMulticolor2', 'tags', 'grid', 'width'])
const SELECTION_KEYS = new Set(['order', 'id', 'name', 'prevSize', 'code', 'codes', 'ligatures'])
const SET_KEYS = new Set(['id', 'metadata', 'height', 'prevSize', 'invisible', 'colorThemes', 'colorThemeIdx', 'icons', 'selection'])
const SET_META_KEYS = new Set(['name', 'url', 'designer', 'designerURL', 'license', 'licenseURL', 'importSize'])
const PROJECT_KEYS = new Set(['metadata', 'iconSets', 'preferences'])
const PROJECT_META_KEYS = new Set(['name', 'created'])

function toPreferences(p: IcoMoonPreferences | undefined): Preferences {
  const d = defaultPreferences()
  if (!p) return d
  const fp = p.fontPref ?? {}
  const metrics = fp.metrics ?? {}
  const meta = fp.metadata ?? {}
  return {
    font: {
      family: meta.fontFamily ?? d.font.family,
      prefix: fp.prefix ?? d.font.prefix,
      postfix: fp.postfix ?? d.font.postfix,
      majorVersion: meta.majorVersion ?? d.font.majorVersion,
      minorVersion: meta.minorVersion ?? d.font.minorVersion,
      emSize: metrics.emSize ?? d.font.emSize,
      baselinePct: metrics.baseline ?? d.font.baselinePct,
      whitespacePct: metrics.whitespace ?? d.font.whitespacePct,
      embed: fp.embed ?? d.font.embed,
      selector: fp.selector === 'attribute' ? 'attribute' : 'class',
      classSelector: fp.classSelector ?? d.font.classSelector,
      cssVars: fp.cssVars ?? d.font.cssVars,
      cssVarsFormat: (fp.cssVarsFormat as Preferences['font']['cssVarsFormat']) || 'css',
      showMetrics: fp.showMetrics ?? d.font.showMetrics,
      showMetadata: fp.showMetadata ?? d.font.showMetadata,
      showVersion: fp.showVersion ?? d.font.showVersion,
      classPerGlyph: d.font.classPerGlyph,
      // IcoMoon's `cssVars` means "define a property per glyph"
      propertyPerGlyph: fp.cssVars ? true : d.font.propertyPerGlyph,
      glyphNamesInFont: d.font.glyphNamesInFont,
      palettePrefix: (fp.palettePrefix as string) ?? d.font.palettePrefix,
      allColorPalettes: Boolean(fp.showColorPalettes ?? d.font.allColorPalettes),
    },
    gridSize: p.gridSize ?? d.gridSize,
    historySize: p.historySize ?? d.historySize,
    showCodes: p.showCodes ?? d.showCodes,
    showGlyphNames: d.showGlyphNames,
  }
}

function toGlyph(
  icon: IcoMoonIcon, iconIndex: number,
  sel: IcoMoonSelectionEntry | undefined, selIndex: number | undefined,
  setKey: string, warnings: string[],
): Glyph {
  const name = sel?.name ?? icon.tags[0] ?? `icon-${icon.id}`
  if (!sel) warnings.push(`glyph "${name}": no selection entry for icon id ${icon.id}; codepoint not imported`)
  const width = icon.width as number | undefined
  return {
    // IcoMoon ids are unique per SET, not per project
    id: `${setKey}:${icon.id}`,
    name,
    aliases: (sel?.ligatures ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    tags: [...icon.tags],
    paths: [...icon.paths],
    attrs: icon.attrs.map((a) => ({ ...a })),
    grid: icon.grid,
    isMulticolor: Boolean(icon.isMulticolor || icon.isMulticolor2),
    // IcoMoon's `width` is a per-glyph advance in the set's coordinate space
    ...(width !== undefined ? { advanceWidth: width } : {}),
    source: {},
    foreign: {
      icoMoonId: icon.id,
      isMulticolor2: icon.isMulticolor2,
      order: sel?.order,
      prevSize: sel?.prevSize,
      icon: { ...capture(icon as Record<string, unknown>, ICON_KEYS), index: iconIndex },
      ...(sel ? { selection: { ...capture(sel as Record<string, unknown>, SELECTION_KEYS), index: selIndex } } : {}),
    },
  }
}

function toSet(set: IcoMoonSet, index: number, projectId: string, codepoints: Project['codepoints'], warnings: string[]): IconSet {
  const setKey = `${projectId}-set-${index}`
  const selIndexById = new Map(set.selection.map((s, i) => [s.id, i]))

  const glyphs = set.icons.map((icon, iconIndex) => {
    const selIndex = selIndexById.get(icon.id)
    const sel = selIndex === undefined ? undefined : set.selection[selIndex]
    const glyph = toGlyph(icon, iconIndex, sel, selIndex, setKey, warnings)
    if (sel) {
      if (codepoints[glyph.name] !== undefined) {
        warnings.push(`duplicate glyph name "${glyph.name}" across sets — codepoints are keyed by name, first wins`)
      } else {
        codepoints[glyph.name] = sel.codes?.length ? [...sel.codes] : sel.code
      }
    }
    return glyph
  })

  // Our model stores glyphs in DISPLAY order (IcoMoon's selection[].order);
  // the original array positions ride along in `foreign` for export.
  glyphs.sort((a, b) => ((a.foreign?.order as number) ?? 0) - ((b.foreign?.order as number) ?? 0))

  return {
    ...emptySet(setKey, set.metadata.name),
    height: set.height,
    prevSize: set.prevSize,
    hidden: Boolean(set.invisible),
    metadata: {
      url: set.metadata.url,
      designer: set.metadata.designer,
      designerURL: set.metadata.designerURL,
      license: set.metadata.license,
      licenseURL: set.metadata.licenseURL,
      importSize: set.metadata.importSize,
    },
    colorThemes: structuredClone(set.colorThemes ?? []),
    ...(set.colorThemeIdx !== undefined ? { colorThemeIdx: set.colorThemeIdx } : {}),
    glyphs,
    foreign: {
      icoMoonId: set.id,
      iconsHash: set.metadata.iconsHash,
      set: capture(set as Record<string, unknown>, SET_KEYS),
      metadata: capture(set.metadata as Record<string, unknown>, SET_META_KEYS),
    },
  }
}

/** Shapes B and C are normalized into shape A so there is exactly one importer. */
function selectionFileToProject(file: IcoMoonSelectionFile): IcoMoonProjectFile {
  const sets = new Map<number, IcoMoonSet>()
  for (const entry of file.icons) {
    const setId = entry.setId ?? entry.setIdx ?? 0
    if (!sets.has(setId)) {
      sets.set(setId, {
        id: setId,
        metadata: { name: file.metadata?.name ?? 'Imported set' },
        height: file.height ?? 1024,
        prevSize: entry.properties?.prevSize ?? 32,
        icons: [],
        selection: [],
      })
    }
    const set = sets.get(setId)!
    // selection.json nests the icon; the project shape keeps two parallel arrays
    set.icons.push(entry.icon)
    set.selection.push(entry.properties)
  }
  return { metadata: file.metadata ?? { name: 'Imported' }, iconSets: [...sets.values()], preferences: file.preferences }
}

const iconSetFileToProject = (file: IcoMoonIconSetFile): IcoMoonProjectFile => ({
  metadata: { name: (file.metadata as { name?: string } | undefined)?.name ?? 'Imported set' },
  iconSets: [{ ...(file as unknown as IcoMoonSet), id: file.id ?? 0 }],
  preferences: {},
})

export function importIcoMoon(data: unknown, opts: { projectId?: string } = {}): ImportResult {
  const kind = detectIcoMoon(data)
  if (!kind) throw new Error('not an IcoMoon file: expected `iconSets` (project) or `IcoMoonType` (selection/iconSet)')

  const file =
    kind === 'project' ? (data as IcoMoonProjectFile)
    : kind === 'selection' ? selectionFileToProject(data as IcoMoonSelectionFile)
    : iconSetFileToProject(data as IcoMoonIconSetFile)

  const warnings: string[] = []
  const projectId = opts.projectId ?? 'p0'
  const codepoints: Project['codepoints'] = {}
  const sets = file.iconSets.map((s, i) => toSet(s, i, projectId, codepoints, warnings))

  return {
    warnings,
    project: {
      schemaVersion: 1,
      id: projectId,
      name: file.metadata?.name ?? 'Imported project',
      createdAt: file.metadata?.created ?? 0,
      sets,
      preferences: toPreferences(file.preferences),
      codepoints,
      foreign: {
        kind,
        project: capture(file as unknown as Record<string, unknown>, PROJECT_KEYS),
        metadata: capture((file.metadata ?? {}) as Record<string, unknown>, PROJECT_META_KEYS),
        // the whole original preferences block, so unknown keys re-export untouched
        preferences: structuredClone(file.preferences ?? {}),
      },
    },
  }
}

export const isIcoMoonFile = (data: unknown): boolean => detectIcoMoon(data) !== null
export type { IcoMoonFile }
