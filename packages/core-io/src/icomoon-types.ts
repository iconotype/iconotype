/**
 * IcoMoon's on-disk shapes, verified against a real export (fixtures/icomoon/alpimaps.json:
 * 3 sets, 25 glyphs, one multicolor). Fields we do not model are still carried through
 * verbatim so re-export is lossless — see `foreign` on our own types.
 */

export interface IcoMoonIcon {
  id: number
  /** one entry per color layer */
  paths: string[]
  /** parallel to paths; `{}` for monochrome, `{ fill: 'rgb(r, g, b)' }` per layer otherwise */
  attrs: Array<Record<string, string>>
  isMulticolor: boolean
  isMulticolor2: boolean
  /** first tag is the display name */
  tags: string[]
  /** source grid; 0 means "no grid" */
  grid: number
  [k: string]: unknown
}

export interface IcoMoonSelectionEntry {
  order: number
  id: number
  name: string
  prevSize: number
  /** decimal codepoint — 59664 === 0xE910 */
  code: number
  /** multicolor glyphs occupy one codepoint per layer */
  codes?: number[]
  tempChar?: string
  ligatures?: string
  [k: string]: unknown
}

export interface IcoMoonSet {
  id: number
  metadata: {
    name: string
    url?: string
    designer?: string
    designerURL?: string
    license?: string
    licenseURL?: string
    iconsHash?: number
    importSize?: { width: number; height: number }
    [k: string]: unknown
  }
  /** coordinate space the paths live in (1024 in every sample seen) */
  height: number
  prevSize: number
  /** set disabled in the project */
  invisible?: boolean
  colorThemes?: Array<Array<[number, number, number, number]>>
  colorThemeIdx?: number
  icons: IcoMoonIcon[]
  /** parallel to `icons`, joined by `id` — NOT nested */
  selection: IcoMoonSelectionEntry[]
  [k: string]: unknown
}

/** Shape A — `File → Save` from the app. */
export interface IcoMoonProjectFile {
  metadata: { name: string; lastOpened?: number; created?: number; [k: string]: unknown }
  iconSets: IcoMoonSet[]
  preferences: IcoMoonPreferences
  uid?: number
  [k: string]: unknown
}

/** Shape B — `selection.json` inside a downloaded font zip. */
export interface IcoMoonSelectionFile {
  IcoMoonType: 'selection'
  icons: Array<{
    icon: IcoMoonIcon
    attrs: Array<Record<string, string>>
    properties: IcoMoonSelectionEntry
    setIdx: number
    setId: number
    iconIdx: number
  }>
  height: number
  metadata: { name: string; [k: string]: unknown }
  preferences: IcoMoonPreferences
  [k: string]: unknown
}

/** Shape C — a library set export. */
export interface IcoMoonIconSetFile extends Omit<IcoMoonSet, 'id'> {
  IcoMoonType: 'iconSet'
  id?: number
}

export interface IcoMoonPreferences {
  showGlyphs?: boolean
  showCodes?: boolean
  showQuickUse?: boolean
  showQuickUse2?: boolean
  showSVGs?: boolean
  gridSize?: number
  historySize?: number
  fontPref?: {
    prefix?: string
    postfix?: string
    metadata?: { fontFamily?: string; majorVersion?: number; minorVersion?: number; [k: string]: unknown }
    metrics?: { emSize?: number; baseline?: number; whitespace?: number; [k: string]: unknown }
    embed?: boolean
    showSelector?: boolean
    selector?: string
    classSelector?: string
    showMetrics?: boolean
    showMetadata?: boolean
    showVersion?: boolean
    cssVars?: boolean
    cssVarsFormat?: string
    ie7?: boolean
    [k: string]: unknown
  }
  imagePref?: Record<string, unknown>
  [k: string]: unknown
}

export type IcoMoonFile = IcoMoonProjectFile | IcoMoonSelectionFile | IcoMoonIconSetFile

export function detectIcoMoon(data: unknown): 'project' | 'selection' | 'iconSet' | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.IcoMoonType === 'selection') return 'selection'
  if (d.IcoMoonType === 'iconSet') return 'iconSet'
  if (Array.isArray(d.iconSets)) return 'project'
  return null
}
