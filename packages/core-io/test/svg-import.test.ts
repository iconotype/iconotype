import { describe, expect, it } from 'vitest'
import { importSvg, importSvgZip, writeZip } from '../src/index.js'
import { getPaper } from '@glyphsmith/core-svg'

const area = (paths: string[]) => {
  const p = getPaper()
  const item = new p.CompoundPath(paths.join(''))
  const a = Math.abs(item.area)
  item.remove()
  return a
}

describe('SVG import', () => {
  it('fits a 24-grid viewBox into the 1024 coordinate space', () => {
    const { glyph, warnings } = importSvg(
      '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="12"/></svg>', 'block.svg')
    expect(warnings).toEqual([])
    // half the em box: 1024 × 512
    expect(area(glyph.paths)).toBeCloseTo(1024 * 512, -2)
  })

  it('centres a non-square viewBox instead of stretching it', () => {
    const { glyph } = importSvg('<svg viewBox="0 0 48 24"><rect width="48" height="24"/></svg>', 'wide.svg')
    const item = new (getPaper().CompoundPath)(glyph.paths[0]!)
    expect(item.bounds.width).toBeCloseTo(1024, 0)
    expect(item.bounds.height).toBeCloseTo(512, 0)
    expect(item.bounds.y).toBeCloseTo(256, 0)   // vertically centred, not top-aligned
    item.remove()
  })

  it('bakes nested group transforms', () => {
    const flat = importSvg('<svg viewBox="0 0 24 24"><rect x="12" y="0" width="12" height="12"/></svg>', 'a.svg')
    const nested = importSvg(
      '<svg viewBox="0 0 24 24"><g transform="translate(12,0)"><g transform="scale(2)"><rect width="6" height="6"/></g></g></svg>', 'b.svg')
    expect(area(nested.glyph.paths)).toBeCloseTo(area(flat.glyph.paths), -1)
  })

  it('converts primitives and normalizes away arcs and shorthand', () => {
    const { glyph } = importSvg('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>', 'dot.svg')
    expect(glyph.paths[0]).not.toMatch(/[Aa]/)
    expect(area(glyph.paths)).toBeCloseTo(Math.PI * 256 * 256, -4)
  })

  it('outlines strokes at the transformed width', () => {
    // 24-grid line, stroke-width 2 → scaled ×(1024/24), area ≈ length × width
    const { glyph } = importSvg(
      '<svg viewBox="0 0 24 24"><path d="M2 12H22" fill="none" stroke="#000" stroke-width="2"/></svg>', 'line.svg')
    const s = 1024 / 24
    expect(area(glyph.paths)).toBeCloseTo(20 * s * 2 * s, -3)
  })

  it('splits distinct fills into layers, IcoMoon-style', () => {
    const { glyph, warnings } = importSvg(
      '<svg viewBox="0 0 24 24"><rect width="12" height="24" fill="#f00"/><rect x="12" width="12" height="24" fill="#00f"/></svg>', 'two.svg')
    expect(glyph.isMulticolor).toBe(true)
    expect(glyph.paths).toHaveLength(2)
    expect(glyph.attrs).toEqual([{ fill: '#f00' }, { fill: '#00f' }])
    expect(warnings.join()).toMatch(/MULTIPLE_COLORS/)
  })

  it('reports clearly what a font cannot represent', () => {
    const cases: Array<[string, RegExp]> = [
      ['<svg><text>hi</text></svg>', /TEXT_ELEMENT/],
      ['<svg><image href="x.png"/></svg>', /IMAGE_EMBEDDED/],
      ['<svg><defs><linearGradient id="g"/></defs><rect width="1" height="1" fill="url(#g)"/></svg>', /GRADIENT_UNSUPPORTED/],
      ['<svg><rect width="1" height="1" stroke="url(#g)" stroke-width="1"/></svg>', /GRADIENT_UNSUPPORTED/],
      ['<svg><rect width="4" height="4" clip-path="url(#c)"/><clipPath id="c"><rect width="2" height="2"/></clipPath></svg>', /CLIP_APPLIED/],
      ['<svg><use href="#missing"/></svg>', /EXTERNAL_REF/],
      ['<svg><path d="M0 0H10" stroke="#000" stroke-dasharray="2 2"/></svg>', /STROKE_DASHARRAY/],
    ]
    for (const [svg, pattern] of cases) {
      const { findings } = importSvg(svg, 't.svg')
      expect(findings.map((f) => `${f.code}: ${f.message}`).join('\n'), svg).toMatch(pattern)
    }
  })

  it('derives a CSS-safe glyph name from the filename', () => {
    expect(importSvg('<svg/>', 'My Icon (24px).svg').glyph.name).toBe('my-icon-24px')
  })

  it('rejects non-SVG input with a useful message', () => {
    expect(() => importSvg('<div><span/></div>', 'x.svg')).toThrow(/x\.svg: no <svg> element found/)
    expect(() => importSvg('', 'empty.svg')).toThrow(/empty\.svg: no <svg> element found/)
    expect(() => importSvg('<svg><rect', 'trunc.svg')).toThrow(/trunc\.svg: could not parse the SVG/)
  })
})

describe('zip import', () => {
  it('reads every SVG in an archive and reports per-file problems', () => {
    const zip = writeZip([
      { path: 'icons/a.svg', data: '<svg viewBox="0 0 24 24"><rect width="24" height="24"/></svg>' },
      { path: 'icons/b.svg', data: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>' },
      { path: 'icons/broken.svg', data: '<html></html>' },
      { path: '__MACOSX/._a.svg', data: 'junk' },
      { path: 'readme.txt', data: 'ignored' },
    ])
    const { glyphs, warnings, results } = importSvgZip(zip)
    expect(glyphs.map((g) => g.name)).toEqual(['a', 'b'])
    expect(results.every((r) => Array.isArray(r.findings))).toBe(true)
    expect(warnings.join()).toMatch(/broken\.svg: no <svg> element found/)
    expect(warnings.join()).not.toMatch(/broken\.svg: broken\.svg/)   // no double prefix
  })

  it('explains itself when an IcoMoon zip has no selection.json', async () => {
    const { importIcoMoonZip } = await import('../src/index.js')
    expect(() => importIcoMoonZip(writeZip([{ path: 'fonts/icomoon.ttf', data: 'x' }])))
      .toThrow(/no selection\.json/)
  })
})
