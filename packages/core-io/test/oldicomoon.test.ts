import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importIcoMoon, isIcoMoonFile } from '../src/index.js'

/**
 * An IcoMoon project from an older version of the app.
 *
 * It differs from a current export in small ways that are easy to trip over: no
 * `ligatures` on a selection entry, a `tempChar` instead, `uid: -1` at the top level,
 * per-glyph `width`, and `resetPoint` rather than a codepoint per icon.
 */
const project = () => JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../fixtures/icomoon/ossweather.json', import.meta.url)), 'utf8'))

describe('older IcoMoon exports', () => {
  it('is recognised', () => {
    expect(isIcoMoonFile(project())).toBe(true)
  })

  it('imports every icon with its codepoint and its advance width', () => {
    const { project: p, warnings } = importIcoMoon(project())
    const glyphs = p.sets.flatMap((s) => s.glyphs)

    expect(glyphs).toHaveLength(10)
    // display order is the selection's `order`, not the array order
    expect(glyphs.map((g) => g.name)).toEqual([
      'wind_0', 'wind_1', 'wind_2', 'wind_3', 'wind_4', 'wind_5', 'wind_6', 'wind_7',
      'refresh', 'rain-snow',
    ])
    expect(p.codepoints['wind_0']).toBe(59648)
    expect(p.codepoints['rain-snow']).toBe(59657)
    // a non-square glyph keeps its advance, or every wind arrow renders squashed
    expect(glyphs.find((g) => g.name === 'wind_0')!.advanceWidth).toBe(1034)
    expect(warnings).toEqual([])
  })

  it('carries the font preferences across', () => {
    const { project: p } = importIcoMoon(project())
    expect(p.preferences.font.prefix).toBe('app-')
    expect(p.preferences.font.family).toBe('ossweather')
    expect(p.preferences.font.emSize).toBe(512)
  })
})
