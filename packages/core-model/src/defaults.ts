import type { FontPrefs, IconSet, Preferences, Project } from './types.js'

/** Matches IcoMoon's defaults so imported projects round-trip without surprises. */
export const defaultFontPrefs = (): FontPrefs => ({
  family: 'iconotype',
  prefix: 'icon-',
  postfix: '',
  majorVersion: 1,
  minorVersion: 0,
  emSize: 1024,
  baselinePct: 6.25,
  whitespacePct: 50,
  embed: false,
  selector: 'class',
  classSelector: '.icon',
  cssVars: true,
  cssVarsFormat: 'css',
  showMetrics: true,
  showMetadata: true,
  showVersion: true,
  classPerGlyph: true,
  propertyPerGlyph: false,
  glyphNamesInFont: true,
  palettePrefix: 'palette',
  allColorPalettes: false,
})

export const defaultPreferences = (): Preferences => ({
  font: defaultFontPrefs(),
  gridSize: 16,
  historySize: 50,
  showCodes: true,
  showGlyphNames: true,
})

export const emptySet = (id: string, name: string): IconSet => ({
  id,
  name,
  height: 1024,
  prevSize: 32,
  hidden: false,
  metadata: {},
  colorThemes: [],
  glyphs: [],
})

export const emptyProject = (id: string, name = 'Untitled project', now = 0): Project => ({
  schemaVersion: 1,
  id,
  name,
  createdAt: now,
  sets: [emptySet(id + '-set-0', 'Untitled Set')],
  preferences: defaultPreferences(),
  codepoints: {},
})
