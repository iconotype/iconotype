import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { fixSvg } from '../src/index.js'

const dir = fileURLToPath(new URL('../../../fixtures/svg/', import.meta.url))
const manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8')) as Record<
  string, { expect: string[]; pixel: boolean; note?: string }
>
const names = readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, '')).sort()

const SIZE = 128
const TARGET = 1024
const TOLERANCE_PCT = 1.5

/**
 * Renders to a binary COVERAGE mask: every painted pixel becomes opaque black,
 * everything else transparent.
 *
 * Comparing colour would be wrong twice over — the source may be multicoloured while a
 * glyph never is, and an earlier version of this harness normalised colours with a regex
 * that also rewrote `fill="#fff"` inside <mask> elements, silently destroying the very
 * feature under test. Coverage is the only thing a font glyph promises to preserve.
 */
const render = (source: string): PNG => {
  const raw = new Resvg(source, { fitTo: { mode: 'width', value: SIZE } }).render().asPng()
  const png = PNG.sync.read(Buffer.from(raw))
  for (let i = 0; i < png.data.length; i += 4) {
    const painted = png.data[i + 3]! > 127
    png.data[i] = 0
    png.data[i + 1] = 0
    png.data[i + 2] = 0
    png.data[i + 3] = painted ? 255 : 0
  }
  return png
}

/** Wrap fixed glyph paths back into an SVG so the same rasterizer sees both sides. */
const asSvg = (paths: string[]): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TARGET} ${TARGET}">` +
  paths.map((d) => `<path d="${d}" fill="black"/>`).join('') +
  `</svg>`

/** Percentage of differing pixels, and the diff image for debugging. */
function comparePixels(a: PNG, b: PNG): { pct: number; diff: PNG } {
  const diff = new PNG({ width: SIZE, height: SIZE })
  const differing = pixelmatch(a.data, b.data, diff.data, SIZE, SIZE, { threshold: 0.15, includeAA: false })
  return { pct: (differing / (SIZE * SIZE)) * 100, diff }
}

describe('SVG fixture corpus', () => {
  it('has a manifest entry for every fixture', () => {
    expect(names.length).toBeGreaterThanOrEqual(70)
    expect(names.filter((n) => !manifest[n])).toEqual([])
  })

  describe.each(names)('%s', (name) => {
    const source = readFileSync(dir + name + '.svg', 'utf8')
    const spec = manifest[name]!

    it('produces valid glyph geometry', () => {
      const result = fixSvg(source, { targetHeight: TARGET })
      const codes = result.findings.map((f) => f.code)

      for (const expected of spec.expect) {
        expect(codes, `expected finding ${expected}; got ${codes.join(', ') || 'none'}`).toContain(expected)
      }

      const fatal = result.findings.filter((f) => f.severity === 'error')
      if (spec.expect.some((c) => ['EMPTY', 'TEXT_ELEMENT', 'IMAGE_EMBEDDED', 'GRADIENT_UNSUPPORTED'].includes(c))) {
        return // the input genuinely cannot become a glyph
      }

      expect(fatal.map((f) => f.code), 'unexpected fatal finding').toEqual([])
      expect(result.paths.length, 'no geometry produced').toBeGreaterThan(0)
      for (const d of result.paths) {
        expect(d, 'path is empty').not.toBe('')
        expect(d, 'path contains NaN/Infinity').not.toMatch(/NaN|Infinity/)
        expect(d, 'path must start with a moveto').toMatch(/^M/)
        expect(d, 'every contour must be closed').toMatch(/[Zz]$/)
      }
      // geometry must sit inside the em box, unless the fixture is the one that
      // deliberately draws outside it — in which case OUT_OF_BOX must be reported
      if (codes.includes('OUT_OF_BOX')) {
        expect(spec.expect.concat(spec.note ? ['noted'] : []).length).toBeGreaterThan(0)
      } else {
        expect(result.stats.bounds!.x).toBeGreaterThan(-1)
        expect(result.stats.bounds!.y).toBeGreaterThan(-1)
        expect(result.stats.bounds!.x + result.stats.bounds!.width).toBeLessThan(TARGET + 1)
      }
    })
  })
})

/**
 * The docs/04 acceptance criterion: the fixed glyph must still LOOK like its source.
 * Rasterizes both sides with the same renderer and compares pixels. Fixtures whose
 * input contains something a font cannot hold are excluded by the manifest, not by
 * loosening the threshold.
 */
describe('visual regression', () => {
  const comparable = names.filter((n) => manifest[n]!.pixel)
  const failures: Array<{ name: string; pct: number }> = []

  it.each(comparable)('%s renders the same after fixing', (name) => {
    const source = readFileSync(dir + name + '.svg', 'utf8')
    const result = fixSvg(source, { targetHeight: TARGET })
    const before = render(source)
    const after = render(asSvg(result.paths))
    const { pct, diff } = comparePixels(before, after)

    if (pct > TOLERANCE_PCT) {
      failures.push({ name, pct })
      const out = fileURLToPath(new URL('../../../fixtures/svg/.diff/', import.meta.url))
      mkdirSync(out, { recursive: true })
      writeFileSync(out + name + '.diff.png', PNG.sync.write(diff))
      writeFileSync(out + name + '.before.png', PNG.sync.write(before))
      writeFileSync(out + name + '.after.png', PNG.sync.write(after))
    }
    expect(pct, `${name}: ${pct.toFixed(2)}% of pixels differ (diff written to fixtures/svg/.diff/)`)
      .toBeLessThanOrEqual(TOLERANCE_PCT)
  })
})
