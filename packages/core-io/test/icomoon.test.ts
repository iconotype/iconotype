import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { exportIcoMoonProject, exportIcoMoonSelection, importIcoMoon } from '../src/index.js'
import type { IcoMoonProjectFile } from '../src/index.js'

const fixture = () =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/icomoon/alpimaps.json', import.meta.url)), 'utf8')) as IcoMoonProjectFile

describe('IcoMoon project import', () => {
  const { project, warnings } = importIcoMoon(fixture())

  it('reads the real project: 3 sets, 25 glyphs, no warnings', () => {
    expect(warnings).toEqual([])
    expect(project.name).toBe('alpimaps')
    expect(project.sets).toHaveLength(3)
    expect(project.sets.map((s) => s.glyphs.length)).toEqual([1, 3, 21])
    expect(project.sets.reduce((n, s) => n + s.glyphs.length, 0)).toBe(25)
  })

  it('carries set metadata and licensing through', () => {
    const material = project.sets[0]!
    expect(material.name).toBe('Material Icons (subset)')
    expect(material.metadata.license).toBe('Apache License Version 2.0')
    expect(material.metadata.importSize).toEqual({ width: 24, height: 24 })
    expect(material.height).toBe(1024)
  })

  it('joins the parallel icons[] / selection[] arrays by id', () => {
    const walk = project.sets[0]!.glyphs[0]!
    expect(walk.name).toBe('directions_walk')
    expect(walk.tags).toEqual(['directions_walk'])
    expect(walk.grid).toBe(24)
    expect(walk.paths[0]).toMatch(/^M418 380/)
  })

  it('imports codepoints, including a multicolor run', () => {
    // 59664 === 0xE910, matching what IcoMoon's UI shows
    expect(project.codepoints.directions_walk).toBe(0xe910)
    const multi = project.sets.flatMap((s) => s.glyphs).find((g) => g.isMulticolor)!
    expect(Array.isArray(project.codepoints[multi.name])).toBe(true)
    expect((project.codepoints[multi.name] as number[]).length).toBeGreaterThan(1)
  })

  it('keeps the em size distinct from the path coordinate height (512 vs 1024)', () => {
    expect(project.preferences.font.emSize).toBe(512)
    expect(project.sets[0]!.height).toBe(1024)
    expect(project.preferences.font.family).toBe('alpimaps')
    expect(project.preferences.font.cssVarsFormat).toBe('scss')
  })

  it('scopes glyph ids by set — IcoMoon ids are only unique within a set', () => {
    const ids = project.sets.flatMap((s) => s.glyphs.map((g) => g.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('IcoMoon round-trip', () => {
  // The M1 acceptance criterion.
  it('import → export reproduces the original file exactly', () => {
    const original = fixture()
    const { project } = importIcoMoon(original)
    expect(exportIcoMoonProject(project)).toEqual(original)
  })

  it('survives a second round-trip (no drift on re-import)', () => {
    const once = exportIcoMoonProject(importIcoMoon(fixture()).project)
    const twice = exportIcoMoonProject(importIcoMoon(once).project)
    expect(twice).toEqual(once)
  })

  it('preserves key order, so the JSON is byte-identical', () => {
    const original = fixture()
    const exported = exportIcoMoonProject(importIcoMoon(original).project)
    expect(JSON.stringify(exported)).toBe(JSON.stringify(original))
  })

  it('also emits a selection.json a font zip can ship', () => {
    const { project } = importIcoMoon(fixture())
    const sel = exportIcoMoonSelection(project)
    expect(sel.IcoMoonType).toBe('selection')
    expect(sel.icons).toHaveLength(25)
    expect(sel.icons[0]!.properties.name).toBe('directions_walk')
    expect(sel.icons[0]!.icon.paths[0]).toMatch(/^M418 380/)
  })

  it('re-imports its own selection.json export', () => {
    const { project } = importIcoMoon(fixture())
    const reimported = importIcoMoon(exportIcoMoonSelection(project)).project
    expect(reimported.sets.reduce((n, s) => n + s.glyphs.length, 0)).toBe(25)
    expect(reimported.codepoints.directions_walk).toBe(0xe910)
  })
})

describe('IcoMoon detection', () => {
  it('rejects non-IcoMoon input with a useful message', () => {
    expect(() => importIcoMoon({ hello: 'world' })).toThrow(/not an IcoMoon file/)
  })
})
