import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { defaultFontPrefs, emptySet, type Glyph, type Project } from '@glyphsmith/core-model'
import { emptyProject } from '@glyphsmith/core-model'
import { importIcoMoon } from '@glyphsmith/core-io'
import { advanceFor, buildBundle, buildCss, buildDemoHtml, buildFont, buildSvgFont, buildVariables, metricsFrom, svgToFontMatrix } from '../src/index.js'

const glyph = (name: string, over: Partial<Glyph> = {}): Glyph => ({
  id: name, name, aliases: [], tags: [], paths: ['M100 100H900V900H100Z'], attrs: [{}],
  grid: 24, isMulticolor: false, ...over,
})

function project(glyphs: Glyph[], codepoints: Project['codepoints'], over: Partial<Project> = {}): Project {
  const base = emptyProject('p', 'test')
  return {
    ...base,
    sets: [{ ...emptySet('s', 'set'), glyphs }],
    preferences: { ...base.preferences, font: { ...defaultFontPrefs(), family: 'testfont' } },
    codepoints,
    ...over,
  }
}

const parse = (ttf: Uint8Array) => opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength))
const sig = (b: Uint8Array) => [...b.slice(0, 4)].map((n) => n.toString(16).padStart(2, '0')).join('')
const ascii = (b: Uint8Array) => String.fromCharCode(...b.slice(0, 4))

describe('metrics', () => {
  it('derives ascender/descender from the baseline percentage (IcoMoon: 6.25)', () => {
    expect(metricsFrom({ ...defaultFontPrefs(), emSize: 1024, baselinePct: 6.25 }))
      .toEqual({ unitsPerEm: 1024, descender: -64, ascender: 960 })
  })

  it('scales and flips from source space into font space', () => {
    const m = metricsFrom({ ...defaultFontPrefs(), emSize: 512 })
    // the alpimaps case: paths in 1024 space, font em 512
    expect(svgToFontMatrix(1024, m)).toEqual([0.5, 0, 0, -0.5, 0, m.ascender])
  })

  it('scales a per-glyph advance width into font units', () => {
    const m = metricsFrom({ ...defaultFontPrefs(), emSize: 512 })
    expect(advanceFor(undefined, 1024, m)).toBe(512)  // square by default
    expect(advanceFor(1061, 1024, m)).toBe(531)       // a wide Font Awesome glyph
  })
})

describe('SVG font', () => {
  it('places a glyph upright above the baseline', () => {
    const { glyphs, metrics } = buildSvgFont(project([glyph('box')], { box: 0xe900 }))
    expect(glyphs).toHaveLength(1)
    // source y 100..900 of 1024 → font y flips around the ascender
    const ys = [...glyphs[0]!.pathData.matchAll(/[HV]?(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]))
    expect(Math.max(...ys)).toBeLessThanOrEqual(metrics.ascender)
    expect(glyphs[0]!.pathData).toMatch(/^M/)
  })

  it('emits one glyph per colour layer, using the codepoint run', () => {
    const multi = glyph('flag', {
      paths: ['M0 0H100V100H0Z', 'M100 100H200V200H100Z', 'M200 200H300V300H200Z'],
      attrs: [{ fill: 'rgb(0, 0, 0)' }, { fill: 'rgb(68, 68, 68)' }, {}],
      isMulticolor: true,
    })
    const { glyphs, warnings } = buildSvgFont(project([multi], { flag: [0xe900, 0xe901, 0xe902] }))
    expect(glyphs.map((g) => g.name)).toEqual(['flag-path1', 'flag-path2', 'flag-path3'])
    expect(glyphs.map((g) => g.code)).toEqual([0xe900, 0xe901, 0xe902])
    expect(glyphs[1]!.color).toBe('rgb(68, 68, 68)')
    expect(warnings).toEqual([])
  })

  /**
   * The alpimaps fixture is full of these: `mountaineering` has six path entries, all
   * one colour, one codepoint. Treating each entry as a layer silently drops five
   * sixths of the artwork.
   */
  it('keeps every subpath of a monochrome glyph in ONE glyph', () => {
    const many = glyph('mountaineering', {
      paths: ['M0 0H100V100H0Z', 'M200 200H300V300H200Z', 'M400 400H500V500H400Z'],
      attrs: [{}, {}, {}],
    })
    const { glyphs, warnings } = buildSvgFont(project([many], { mountaineering: 0xe900 }))
    expect(glyphs).toHaveLength(1)
    expect(glyphs[0]!.pathData.match(/M/g)).toHaveLength(3)   // all three subpaths present
    expect(warnings).toEqual([])
  })

  it('warns when a multicolor glyph has too few codepoints', () => {
    const multi = glyph('flag', { paths: ['M0 0H1V1H0Z', 'M1 1H2V2H1Z'], attrs: [{}, {}], isMulticolor: true })
    const { warnings, glyphs } = buildSvgFont(project([multi], { flag: 0xe900 }))
    expect(glyphs).toHaveLength(1)
    expect(warnings[0]!.code).toBe('MISSING_LAYER_CODES')
  })

  it('skips glyphs with no codepoint, and says so', () => {
    const { glyphs, warnings } = buildSvgFont(project([glyph('a'), glyph('b')], { a: 0xe900 }))
    expect(glyphs.map((g) => g.name)).toEqual(['a'])
    expect(warnings[0]!.code).toBe('NO_CODEPOINT')
  })

  it('flags a duplicate codepoint instead of silently shadowing a glyph', () => {
    const { warnings } = buildSvgFont(project([glyph('a'), glyph('b')], { a: 0xe900, b: 0xe900 }))
    expect(warnings.map((w) => w.code)).toContain('DUPLICATE_CODEPOINT')
  })

  it('adds blank character glyphs so ligatures can trigger', () => {
    const { svg, ligatureChars, warnings } = buildSvgFont(
      project([glyph('home', { aliases: ['home'] })], { home: 0xe900 }))
    expect(ligatureChars).toEqual(['e', 'h', 'm', 'o'])
    expect(svg).toContain('unicode="&#x68;&#x6f;&#x6d;&#x65;"')   // the "home" sequence
    expect(warnings.map((w) => w.code)).toContain('LIGATURE_BLANKS')
  })

  it('gives the space glyph the configured whitespace advance', () => {
    const p = project([glyph('a')], { a: 0xe900 })
    p.preferences.font.whitespacePct = 50
    p.preferences.font.emSize = 1024
    expect(buildSvgFont(p).svg).toContain('glyph-name="space" horiz-adv-x="512"')
  })

  it('excludes hidden sets', () => {
    const p = project([glyph('a')], { a: 0xe900, b: 0xe901 })
    p.sets.push({ ...emptySet('s2', 'hidden'), hidden: true, glyphs: [glyph('b')] })
    expect(buildSvgFont(p).glyphs.map((g) => g.name)).toEqual(['a'])
  })
})

describe('binary output', () => {
  it('writes a real glyf TTF (not CFF), plus WOFF and WOFF2', async () => {
    const build = await buildFont(project([glyph('box')], { box: 0xe900 }))
    expect(sig(build.ttf!)).toBe('00010000')       // glyf TTF, not 'OTTO'
    expect(ascii(build.woff!)).toBe('wOFF')
    expect(ascii(build.woff2!)).toBe('wOF2')
    expect(build.woff2!.byteLength).toBeLessThan(build.ttf!.byteLength)
  })

  it('produces a font that actually contains the glyph outlines', async () => {
    const { ttf } = await buildFont(project([glyph('box')], { box: 0xe900 }), { formats: ['ttf'] })
    const font = parse(ttf!)
    expect(font.unitsPerEm).toBe(1024)
    expect(font.ascender).toBe(960)
    expect(font.descender).toBe(-64)
    const g = font.charToGlyph(String.fromCodePoint(0xe900))
    expect(g.path.commands.length).toBeGreaterThan(3)
    // upright: the box occupies positive y above the baseline
    const bbox = g.getBoundingBox()
    expect(bbox.y1).toBeGreaterThan(0)
    expect(bbox.y2).toBeLessThanOrEqual(960)
  })

  it('carries ligatures into a GSUB table', async () => {
    const { ttf } = await buildFont(
      project([glyph('home', { aliases: ['home'] })], { home: 0xe900 }), { formats: ['ttf'] })
    expect(parse(ttf!).tables.gsub).toBeTruthy()
  })

  it('honours a per-glyph advance width', async () => {
    const { ttf } = await buildFont(
      project([glyph('wide', { advanceWidth: 1536 })], { wide: 0xe900 }), { formats: ['ttf'] })
    const font = parse(ttf!)
    expect(font.charToGlyph(String.fromCodePoint(0xe900)).advanceWidth).toBe(1536)
  })

  /**
   * Determinism regression: opentype.js always stamped head.modified with now(), so its
   * output differed between builds a second apart. svg2ttf takes an explicit ts.
   */
  it('is byte-identical across builds separated in time', async () => {
    const p = project([glyph('box')], { box: 0xe900 })
    const a = await buildFont(p, { formats: ['ttf'] })
    await new Promise((r) => setTimeout(r, 1100))
    const b = await buildFont(p, { formats: ['ttf'] })
    expect(Buffer.from(a.ttf!)).toEqual(Buffer.from(b.ttf!))
  })
})

describe('CSS and demo output', () => {
  const p = project([glyph('home'), glyph('user')], { home: 0xe900, user: 0xe901 })

  it('emits @font-face, a base selector and per-icon rules', async () => {
    const build = await buildFont(p, { formats: ['woff2', 'woff', 'ttf'] })
    const css = buildCss(p, build)
    expect(css).toContain(`font-family: 'testfont'`)
    expect(css).toContain(`url('fonts/testfont.woff2') format('woff2')`)
    expect(css.indexOf('woff2')).toBeLessThan(css.indexOf('truetype'))  // best format first
    expect(css).toContain('.icon-home:before { content: "\\e900"; }')
    expect(css).toContain('--icon-home: "\\e900";')
  })

  it('can inline the font as a data URI', async () => {
    const build = await buildFont(p, { formats: ['woff2'] })
    const css = buildCss(p, build, { embed: true })
    expect(css).toContain('url(data:font/woff2;charset=utf-8;base64,')
    expect(css).not.toContain("url('fonts/")
  })

  it('supports the attribute-selector mode', async () => {
    const attr = { ...p, preferences: { ...p.preferences, font: { ...p.preferences.font, selector: 'attribute' as const } } }
    const css = buildCss(attr, await buildFont(attr, { formats: ['woff'] }))
    expect(css).toContain('[class^="icon-"], [class*=" icon-"]')
  })

  it('emits stacked pseudo-elements for multicolor icons', async () => {
    const multi = glyph('flag', {
      paths: ['M0 0H1V1H0Z', 'M1 1H2V2H1Z'], attrs: [{ fill: 'rgb(0, 0, 0)' }, { fill: 'rgb(68, 68, 68)' }], isMulticolor: true,
    })
    const mp = project([multi], { flag: [0xe900, 0xe901] })
    const css = buildCss(mp, await buildFont(mp, { formats: ['woff'] }))
    expect(css).toContain('.icon-flag .path1:before')
    expect(css).toContain('color: rgb(68, 68, 68);')
    expect(css).toContain('margin-left: -1em;')
  })

  it('emits SCSS or LESS variables in the shape IcoMoon does', async () => {
    const build = await buildFont(p, { formats: ['woff'] })
    const scss = buildVariables(p, build, 'scss', { fontPath: '../fonts/' })

    // an existing stylesheet expects the family and path up front, overridable
    expect(scss).toContain('$testfont-font-family: "testfont" !default;')
    expect(scss).toContain('$testfont-font-path: "../fonts" !default;')
    expect(scss).toContain('$icon-home: "\\e900";')
    // the family variables must come before the icons, as in IcoMoon's output
    expect(scss.indexOf('font-family')).toBeLessThan(scss.indexOf('$icon-home'))

    const less = buildVariables(p, build, 'less', { fontPath: 'fonts' })
    expect(less).toContain('@testfont-font-family: "testfont";')   // LESS has no !default
    expect(less).toContain('@icon-home: "\\e900";')
  })

  it('renders a demo page listing every icon', async () => {
    const build = await buildFont(p, { formats: ['woff'] })
    const html = buildDemoHtml(p, build)
    expect(html).toContain('<link rel="stylesheet" href="style.css">')
    expect(html).toContain('class="icon-home"')
    expect(html).toContain('U+e900')
  })
})

describe('bundle', () => {
  it('assembles the downloadable package', async () => {
    const p = project([glyph('home')], { home: 0xe900 })
    const { files } = await buildBundle(p, { selectionJson: '{"IcoMoonType":"selection"}' })
    expect(files.map((f) => f.path).sort()).toEqual([
      'ATTRIBUTION.md', 'codepoints.lock', 'demo.html', 'fonts/testfont.svg',
      'fonts/testfont.ttf', 'fonts/testfont.woff', 'fonts/testfont.woff2',
      'selection.json', 'style.css',
    ])
    expect(String(files.find((f) => f.path === 'codepoints.lock')!.data)).toContain('home\tU+e900')
  })

  it('aggregates per-set licences into ATTRIBUTION.md', async () => {
    const p = project([glyph('a')], { a: 0xe900 })
    p.sets[0]!.name = 'Material Icons (subset)'
    p.sets[0]!.metadata = { license: 'Apache License Version 2.0', designer: 'Google', url: 'https://material.io' }
    const { files } = await buildBundle(p, { formats: ['woff2'] })
    const attribution = String(files.find((f) => f.path === 'ATTRIBUTION.md')!.data)
    expect(attribution).toContain('## Material Icons (subset) (1 icon)')
    expect(attribution).toContain('- License: Apache License Version 2.0')
    expect(attribution).toContain('- Designer: Google')
  })
})

describe('the real project', () => {
  const fixture = () => JSON.parse(readFileSync(
    fileURLToPath(new URL('../../../fixtures/icomoon/alpimaps.json', import.meta.url)), 'utf8'))

  it('builds a working font from alpimaps.json', async () => {
    const { project: p } = importIcoMoon(fixture())
    const build = await buildFont(p, { formats: ['ttf', 'woff2'] })

    // 25 icons, one of which is multicolor with 3 layers → 27 glyph entries
    expect(build.glyphs).toHaveLength(27)
    // and the monochrome multi-subpath glyphs keep every subpath
    const mountaineering = build.glyphs.find((g) => g.name === 'mountainairing')!
    expect(mountaineering.pathData.match(/M/g)!.length).toBe(6)
    expect(build.metrics.unitsPerEm).toBe(512)          // em differs from the 1024 path space
    expect(build.warnings.filter((w) => w.code !== 'LIGATURE_BLANKS')).toEqual([])

    const font = parse(build.ttf!)
    const walk = font.charToGlyph(String.fromCodePoint(0xe910))
    expect(walk.path.commands.length).toBeGreaterThan(10)
    expect(walk.getBoundingBox().y1).toBeGreaterThanOrEqual(build.metrics.descender)

    // a wide Font Awesome glyph keeps its advance
    const flag = build.glyphs.find((g) => g.name === 'flag-checkered')!
    expect(flag.advanceWidth).toBe(531)
  })
})
