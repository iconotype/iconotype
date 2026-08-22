import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { describe, expect, it } from 'vitest'
import { exportIcoMoonSelection, importIcoMoon, readZip, writeZip } from '@glyphsmith/core-io'
import { buildBundle } from '../src/index.js'

const fixture = () => JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../fixtures/icomoon/alpimaps.json', import.meta.url)), 'utf8'))

const text = (data: Uint8Array) => new TextDecoder().decode(data)

/** End-to-end: real project → zip → unzip → the font still parses and the CSS agrees with it. */
describe('downloadable package (alpimaps.json)', () => {
  const buildIt = async () => {
    const { project } = importIcoMoon(fixture())
    const { files, build } = await buildBundle(project, {
      timestamp: 0,
      selectionJson: JSON.stringify(exportIcoMoonSelection(project), null, 2),
    })
    const zip = writeZip(files.map((f) => ({ path: f.path, data: f.data })))
    return { project, build, zip, entries: new Map(readZip(zip).map((e) => [e.path, e.data])) }
  }

  it('contains fonts, stylesheet, demo, lockfile, attribution and selection.json', async () => {
    const { entries } = await buildIt()
    expect([...entries.keys()].sort()).toEqual([
      'ATTRIBUTION.md', 'codepoints.lock', 'demo.html',
      'fonts/alpimaps.svg', 'fonts/alpimaps.ttf', 'fonts/alpimaps.woff', 'fonts/alpimaps.woff2',
      'selection.json', 'style.css',
      'variables.scss',   // alpimaps sets cssVarsFormat: 'scss'
    ])
  })

  it('ships a font that parses and carries every icon', async () => {
    const { entries, build } = await buildIt()
    const ttf = entries.get('fonts/alpimaps.ttf')!
    const font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength))
    expect(font.unitsPerEm).toBe(512)
    for (const glyph of build.glyphs) {
      const g = font.charToGlyph(String.fromCodePoint(glyph.code))
      expect(g.path.commands.length, `${glyph.name} is blank in the font`).toBeGreaterThan(2)
    }
  })

  it('emits CSS whose codepoints match the font exactly', async () => {
    const { entries, build } = await buildIt()
    const css = text(entries.get('style.css')!)
    for (const glyph of build.glyphs) {
      expect(css, `no rule for ${glyph.name}`).toContain(`\\${glyph.code.toString(16)}`)
    }
    // and the @font-face points at files that are actually in the zip
    for (const match of css.matchAll(/url\('([^']+)'\)/g)) {
      const url = match[1]!.replace(/[?#].*$/, '')
      expect(entries.has(url), `${url} missing from the package`).toBe(true)
    }
  })

  it('ships an IcoMoon-compatible selection.json that re-imports', async () => {
    const { entries } = await buildIt()
    const reimported = importIcoMoon(JSON.parse(text(entries.get('selection.json')!))).project
    expect(reimported.sets.reduce((n, s) => n + s.glyphs.length, 0)).toBe(25)
    expect(reimported.codepoints.directions_walk).toBe(0xe910)
  })

  it('records every set licence in ATTRIBUTION.md', async () => {
    const { entries } = await buildIt()
    const attribution = text(entries.get('ATTRIBUTION.md')!)
    expect(attribution).toContain('Apache License Version 2.0')      // Material
    expect(attribution).toContain('https://github.com/FortAwesome/Font-Awesome')
    expect(attribution).toContain('No licence metadata recorded')     // the untitled set
  })

  it('is reproducible: two packages built a second apart are byte-identical', async () => {
    const a = await buildIt()
    await new Promise((r) => setTimeout(r, 1100))
    const b = await buildIt()
    expect(Buffer.from(a.zip)).toEqual(Buffer.from(b.zip))
  })
})
