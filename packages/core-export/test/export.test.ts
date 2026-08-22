import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importIcoMoon } from '@glyphsmith/core-io'
import {
  buildFavicons, buildPngs, buildSpriteSheet, componentFilename, exportCharacter, exportComponent,
  exportDataUri, exportEscape, exportSpriteSymbols, exportSvg, exportTypes, exportUseSnippet,
  iconsOf, type ComponentTarget,
} from '../src/index.js'

const project = importIcoMoon(JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../fixtures/icomoon/alpimaps.json', import.meta.url)), 'utf8'))).project
const entries = iconsOf(project)
const hiking = entries.find((e) => e.glyph.name === 'hiking')!

describe('single SVG export', () => {
  it('writes a standalone file in the set coordinate space', () => {
    const svg = exportSvg(hiking)
    expect(svg).toContain('viewBox="0 0 1024 1024"')
    expect(svg).toContain('<path')
    expect(svg).not.toContain('width=')          // scalable by default
  })

  it('honours the format switches', () => {
    const svg = exportSvg(hiking, { addTitle: true, fixedSize: true, size: 48, removeNewlines: true, useTabs: true })
    expect(svg).toContain('<title>hiking</title>')
    expect(svg).toContain('width="48" height="48"')
    expect(svg).not.toContain('\n')
  })

  it('encodes a data URI usable in CSS', () => {
    const uri = exportDataUri(hiking)
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    expect(uri).not.toMatch(/["'<>]/)            // safe inside url('...')
    expect(decodeURIComponent(uri.slice('data:image/svg+xml,'.length))).toContain('<svg')
  })
})

describe('sprite export', () => {
  it('emits one symbol per icon with prefixed ids', () => {
    const sprite = exportSpriteSymbols(project, entries)
    expect(sprite.match(/<symbol /g)).toHaveLength(25)
    expect(sprite).toContain('<symbol id="icon-hiking" viewBox="0 0 1024 1024">')
    expect(sprite).toContain('style="display:none"')
  })

  it('can leave ids unprefixed', () => {
    expect(exportSpriteSymbols(project, [hiking], { prependNamesToIds: false })).toContain('id="hiking"')
  })

  it('emits a matching use snippet', () => {
    expect(exportUseSnippet(hiking.glyph)).toBe('<svg><use href="#icon-hiking"/></svg>')
  })

  it('lays out a sheet and the CSS that addresses it', () => {
    const sheet = buildSpriteSheet(project, entries, { cell: 32, columns: 8, margin: 16 })
    expect(sheet.positions).toHaveLength(25)
    expect(sheet.positions[0]).toEqual({ name: expect.any(String), x: 0, y: 0 })
    expect(sheet.positions[8]).toMatchObject({ x: 0, y: 48 })   // second row
    expect(sheet.width).toBe(8 * 48 - 16)
    expect(sheet.css).toContain('background-position: -0px -0px;')
    expect(sheet.svg).toContain('<svg xmlns=')
  })
})

describe('quick copy', () => {
  it('gives the literal character and the CSS escape', () => {
    expect(exportCharacter(project, hiking.glyph)).toBe(String.fromCodePoint(0xe914))
    expect(exportEscape(project, hiking.glyph)).toBe('\\e914')
  })

  it('covers every layer of a multicolor icon', () => {
    const multi = entries.find((e) => e.glyph.isMulticolor)!
    expect([...exportCharacter(project, multi.glyph)]).toHaveLength(3)
    expect(exportEscape(project, multi.glyph).split('\\').filter(Boolean)).toHaveLength(3)
  })

  it('returns nothing for a glyph with no codepoint', () => {
    expect(exportCharacter(project, { ...hiking.glyph, name: 'unmapped' })).toBe('')
  })
})

describe('component export', () => {
  const targets: ComponentTarget[] = ['react', 'vue', 'svelte', 'webcomponent', 'elm']

  it.each(targets)('%s output names every icon and carries its geometry', (target) => {
    const source = exportComponent(target, project, entries)
    expect(source).toContain('Glyphsmith')
    expect(source).toContain('hiking')
    expect(source).toContain(hiking.glyph.paths[0]!.slice(0, 40))
    expect(componentFilename(target, project)).toMatch(/Alpimaps\.|alpimaps-/)
  })

  it('react output is valid TSX shape', () => {
    const tsx = exportComponent('react', project, entries)
    expect(tsx).toContain('export function Alpimaps(')
    expect(tsx).toContain('viewBox={`0 0 ${box} ${box}`}')
    expect(tsx).toContain("import { type SVGProps } from 'react'")
  })

  it('svelte output uses runes', () => {
    const svelte = exportComponent('svelte', project, entries)
    expect(svelte).toContain('$props()')
    expect(svelte).toContain('$derived(')
    expect(svelte).toContain('{@html icon[1]}')
  })

  it('elm output emits real Svg.path nodes, not injected markup', () => {
    const elm = exportComponent('elm', project, entries)
    expect(elm).toContain('module Alpimaps exposing (')
    expect(elm).toContain('Svg.path [ A.d "')
    expect(elm).not.toContain('innerHTML')
  })

  it('web component registers a custom element once', () => {
    const js = exportComponent('webcomponent', project, entries)
    expect(js).toContain("customElements.define('icon-icon'")
    expect(js).toContain("if (!customElements.get(")
  })
})

describe('typescript declarations', () => {
  it('emits a union of every icon name plus a lookup', () => {
    const dts = exportTypes(project, entries)
    expect(dts).toContain('export type AlpimapsName =')
    expect(dts).toContain("  | 'hiking'")
    expect(dts).toContain("hiking: 'hiking', // \\ue914")
    expect(dts).toContain('satisfies Record<string, AlpimapsName>')
  })

  it('sanitises names that are not valid identifiers', () => {
    const dts = exportTypes(project, entries)
    // 'paper-plane, send' and 'directions_walk' both have to become identifiers
    expect(dts).toMatch(/paperPlaneSend|paperPlane/)
    expect(dts).not.toMatch(/^\s+paper-plane/m)
  })
})

describe('raster export', () => {
  /** A stub rasterizer keeps this package free of any imaging dependency. */
  const stub = async (svg: string, w: number, h: number) => new TextEncoder().encode(`${w}x${h}:${svg.length}`)

  it('renders one PNG per icon, at 1x and 2x', async () => {
    const pngs = await buildPngs([hiking, ...entries.slice(0, 2)], stub, { size: 32, retina: true })
    expect(pngs.map((p) => p.path)).toEqual(expect.arrayContaining(['png/hiking.png', 'png/hiking@2x.png']))
    expect(new TextDecoder().decode(pngs.find((p) => p.path === 'png/hiking@2x.png')!.data)).toMatch(/^64x64:/)
  })

  it('builds a favicon set with a manifest', async () => {
    const files = await buildFavicons(hiking, stub, { name: 'Alpimaps' })
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining([
      'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'site.webmanifest', 'favicon.svg',
    ]))
    const manifest = JSON.parse(String(files.find((f) => f.path === 'site.webmanifest')!.data))
    expect(manifest.name).toBe('Alpimaps')
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512'])
  })
})
