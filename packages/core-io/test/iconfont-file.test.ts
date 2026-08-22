import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { emptyProject } from '@iconotype/core-model'
import { importIcoMoon, parseIconFont, serializeIconFont, selectedGlyphs, toIconFontFile, fromIconFontFile } from '../src/index.js'

const project = () => importIcoMoon(JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../fixtures/icomoon/alpimaps.json', import.meta.url)), 'utf8'))).project

describe('.iconotype.json project file', () => {
  it('round-trips a real project', () => {
    const before = project()
    const after = parseIconFont(serializeIconFont(before))
    expect(after.name).toBe('alpimaps')
    expect(after.preferences.font.emSize).toBe(512)
    expect(after.codepoints.directions_walk).toBe(0xe910)
    expect(after.sets[0]!.glyphs).toHaveLength(25)
    expect(after.sets[0]!.height).toBe(1024)
  })

  it('keeps multicolor codepoint runs and layer colours', () => {
    const before = project()
    const file = toIconFontFile(before)
    const multi = file.icons.find((i) => i.codes?.length)!
    expect(multi.codes).toHaveLength(2)
    expect(multi.colors).toHaveLength(3)

    const after = fromIconFontFile(file)
    expect(after.codepoints[multi.name]).toEqual([0xe916, 0xe917, 0xe918])
    expect(after.sets[0]!.glyphs.find((g) => g.name === multi.name)!.isMulticolor).toBe(true)
  })

  it('sorts icons by codepoint so a rebuild produces no diff', () => {
    const file = toIconFontFile(project())
    const codes = file.icons.map((i) => parseInt(i.code, 16))
    expect(codes).toEqual([...codes].sort((a, b) => a - b))
    expect(serializeIconFont(project())).toBe(serializeIconFont(project()))
  })

  it('records deselection, and only that', () => {
    const p = project()
    p.sets[0]!.glyphs[0]!.selected = false
    const file = toIconFontFile(p)
    expect(file.icons.find((i) => i.name === 'directions_walk')!.selected).toBe(false)
    // selected icons carry no flag at all, keeping the file quiet
    expect(file.icons.filter((i) => 'selected' in i)).toHaveLength(1)
    expect(selectedGlyphs(fromIconFontFile(file))).toHaveLength(24)
  })

  it('carries the output configuration', () => {
    const p = project()
    p.output = {
      fonts: { dir: 'app/fonts', formats: ['woff2'] },
      styles: [{ kind: 'scss-variables', path: 'app/css/_icons.scss' }],
    }
    const after = parseIconFont(serializeIconFont(p))
    expect(after.output).toEqual(p.output)
  })

  it('preserves licence credits', () => {
    const file = toIconFontFile(project())
    expect(file.credits?.map((c) => c.license)).toContain('Apache License Version 2.0')
  })

  it('refuses a file from a newer Iconotype rather than silently misreading it', () => {
    const file = toIconFontFile(project())
    file.schemaVersion = 99
    expect(() => fromIconFontFile(file)).toThrow(/needs a newer Iconotype/)
  })

  it('rejects json that is not an icon font file', () => {
    expect(() => parseIconFont('{"hello":"world"}')).toThrow(/not a Iconotype icon font file/)
  })

  it('carries usage prefixes through the file, and omits them when unused', () => {
    const project = emptyProject('p', 'app')
    project.preferences.font.prefix = 'icon-'
    project.preferences.font.usagePrefixes = ['alpimaps-']

    const written = serializeIconFont(project)
    expect(written).toContain('"usagePrefixes"')
    expect(parseIconFont(written, 'p').preferences.font.usagePrefixes).toEqual(['alpimaps-'])

    // absent by default: a project whose code writes the class prefix needs no entry
    const plain = emptyProject('p2', 'app')
    expect(serializeIconFont(plain)).not.toContain('usagePrefixes')
    expect(parseIconFont(serializeIconFont(plain), 'p2').preferences.font.usagePrefixes).toBeUndefined()
  })
})
