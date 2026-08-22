import opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { defaultFontPrefs, emptyProject, emptySet, type Glyph, type Project } from '@glyphsmith/core-model'
import { buildCss, buildDemoHtml, buildFont, buildPaletteRules, buildVariables, classNameOf, interpolate } from '../src/index.js'

const glyph = (name: string, over: Partial<Glyph> = {}): Glyph => ({
  id: name, name, aliases: [], tags: [], paths: ['M100 100H900V900H100Z'], attrs: [{}],
  grid: 24, isMulticolor: false, ...over,
})

function project(glyphs: Glyph[], codepoints: Project['codepoints'], font: Partial<Project['preferences']['font']> = {}): Project {
  const base = emptyProject('p', 'test')
  return {
    ...base,
    sets: [{ ...emptySet('s', 'set'), glyphs }],
    preferences: { ...base.preferences, font: { ...defaultFontPrefs(), family: 'app', ...font } },
    codepoints,
  }
}

/** The switches IcoMoon exposes on its export panel. */
describe('class name interpolation', () => {
  it('substitutes the glyph index and codepoint', () => {
    expect(interpolate('icon-', 3, 0xe900)).toBe('icon-')
    expect(interpolate('-${u}', 3, 0xe900)).toBe('-e900')
    expect(interpolate('${i}-', 3, 0xe900)).toBe('3-')
    expect(interpolate('${i}${u}', 0, 0xf001)).toBe('0f001')
  })

  it('builds the full class name from prefix, name and suffix', () => {
    expect(classNameOf({ prefix: 'icon-', postfix: '' }, 'home', 0, 0xe900)).toBe('icon-home')
    expect(classNameOf({ prefix: 'icon-', postfix: '-${u}' }, 'home', 0, 0xe900)).toBe('icon-home-e900')
  })

  it('applies interpolation to the emitted CSS and SCSS', async () => {
    const p = project([glyph('home')], { home: 0xe900 }, { postfix: '-${u}' })
    const build = await buildFont(p, { formats: ['woff2'] })
    expect(buildCss(p, build)).toContain('.icon-home-e900:before')
    expect(buildVariables(p, build, 'scss')).toContain('$icon-home: "\\e900";')
  })
})

describe('class and property switches', () => {
  const p = (font: Partial<Project['preferences']['font']>) => project([glyph('home')], { home: 0xe900 }, font)

  it('emits a class per glyph by default', async () => {
    const proj = p({})
    const css = buildCss(proj, await buildFont(proj, { formats: ['woff2'] }))
    expect(css).toContain('.icon-home:before')
  })

  it('can emit only custom properties, with no per-glyph classes', async () => {
    const proj = p({ classPerGlyph: false, propertyPerGlyph: true, cssVars: false })
    const css = buildCss(proj, await buildFont(proj, { formats: ['woff2'] }))
    expect(css).toContain('--icon-home: "\\e900";')
    expect(css).not.toContain('.icon-home:before')
    // the @font-face and the base selector must survive either way
    expect(css).toContain('@font-face')
    expect(css).toContain(`font-family: 'app' !important`)
  })
})

describe('colour palettes', () => {
  const palette = (): Project => {
    const multi = glyph('flag', {
      paths: ['M0 0H1V1H0Z', 'M1 1H2V2H1Z'],
      attrs: [{ fill: 'rgb(0, 0, 0)' }, { fill: 'rgb(68, 68, 68)' }],
      isMulticolor: true,
    })
    const p = project([multi], { flag: [0xe900, 0xe901] }, { allColorPalettes: true })
    p.sets[0]!.colorThemes = [
      [[0, 0, 0, 1], [68, 68, 68, 1]],
      [[255, 0, 0, 1], [0, 0, 255, 0.5]],
    ]
    return p
  }

  it('emits one rule set per palette', () => {
    const rules = buildPaletteRules(palette()).join('\n')
    expect(rules).toContain('.palette1 .path1:before { color: rgb(0, 0, 0); }')
    expect(rules).toContain('.palette2 .path1:before { color: rgb(255, 0, 0); }')
    expect(rules).toContain('.palette2 .path2:before { color: rgba(0, 0, 255, 0.5); }')
  })

  it('honours a custom palette class prefix', () => {
    const p = palette()
    p.preferences.font.palettePrefix = 'theme'
    expect(buildPaletteRules(p).join('\n')).toContain('.theme1 .path1:before')
  })

  it('includes the palettes in the stylesheet only when asked', async () => {
    const p = palette()
    const build = await buildFont(p, { formats: ['woff2'] })
    expect(buildCss(p, build)).toContain('.palette1 .path1:before')

    p.preferences.font.allColorPalettes = false
    expect(buildCss(p, build)).not.toContain('.palette1')
  })

  it('emits nothing for a project with no palettes', () => {
    expect(buildPaletteRules(project([glyph('home')], { home: 0xe900 }))).toEqual([])
  })
})

describe('font metadata and glyph names', () => {
  it('omits glyph names from the post table when asked, shrinking the font', async () => {
    const named = project([glyph('a-descriptive-glyph-name-here')], { 'a-descriptive-glyph-name-here': 0xe900 })
    const anonymous = project([glyph('a-descriptive-glyph-name-here')], { 'a-descriptive-glyph-name-here': 0xe900 }, { glyphNamesInFont: false })

    const withNames = await buildFont(named, { formats: ['ttf'] })
    const without = await buildFont(anonymous, { formats: ['ttf'] })
    expect(withNames.svg).toContain('glyph-name="a-descriptive-glyph-name-here"')
    expect(without.svg).not.toContain('glyph-name="a-descriptive-glyph-name-here"')
    expect(without.ttf!.byteLength).toBeLessThan(withNames.ttf!.byteLength)
  })

  it('writes copyright, description and url into the name table', async () => {
    const p = project([glyph('home')], { home: 0xe900 }, {
      metadata: { copyright: '(c) 2026 Example Ltd', url: 'https://example.com', description: 'Example icons' },
    })
    const { ttf } = await buildFont(p, { formats: ['ttf'] })
    const font = opentype.parse(ttf!.buffer.slice(ttf!.byteOffset, ttf!.byteOffset + ttf!.byteLength))
    const names = JSON.stringify(font.names)
    expect(names).toContain('Example Ltd')
    expect(names).toContain('example.com')
    expect(names).toContain('Example icons')
    // and the default is not left in place once metadata is supplied
    expect(names).not.toContain('fontello')
  })
})

describe('demo page', () => {
  it('uses the interpolated class names', async () => {
    const p = project([glyph('home')], { home: 0xe900 }, { postfix: '-${u}' })
    expect(buildDemoHtml(p, await buildFont(p, { formats: ['woff2'] }))).toContain('class="icon-home-e900"')
  })
})
