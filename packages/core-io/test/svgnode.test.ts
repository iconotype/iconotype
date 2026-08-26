import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importSvgNodeProject, isSvgNodeProject, renderTaggedSvg } from '../src/index.js'
import { isIcoMoonFile } from '../src/icomoon-import.js'

/**
 * An icon-font project from an older app: no `IcoMoonType`, no `iconSets`, and each
 * glyph holding its SVG as an already-parsed tagged tree instead of markup.
 */
const fixture = (name: string) => JSON.parse(readFileSync(
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), 'utf8'))

const project = () => fixture('svgnode/eosya.json')

const element = (tagName: string, attributes: Record<string, unknown>, children: unknown[] = []) =>
  ({ tag: 'Element', args: [{ tagName, attributes, children }] })

describe('tagged SVG rendering', () => {
  it('renders a closed subpath, typed lengths and paints', () => {
    const { svg, warnings } = renderTaggedSvg(element('svg', {
      viewBox: { tag: 'Value', args: [{ tag: 'ViewBox', args: [{ minX: 0, minY: 0, width: 48, height: 48 }] }] },
      width: { tag: 'Value', args: [{ tag: 'Length', args: [{ tag: 'Px', args: [48] }] }] },
      fill: { tag: 'Value', args: [{ tag: 'Paint', args: [{ tag: 'NoPaint', args: [] }] }] },
    }, [
      { tag: 'Comment', args: [' dropped '] },
      element('path', {
        fill: { tag: 'Value', args: [{ tag: 'Paint', args: [{ tag: 'CurrentColor', args: [] }] }] },
        d: { tag: 'Value', args: [{ tag: 'Paths', args: [[{
          start: [4, 40],
          endings: { tag: 'Connected', args: [] },
          cmds: [
            { tag: 'LineTo', args: [{ point: [20, 12] }] },
            { tag: 'CurveTo', args: [{ control1: [30, 12], control2: [36, 20], point: [36, 40] }] },
          ],
        }]] }] },
      }),
    ]))

    expect(warnings).toEqual([])
    expect(svg).toBe(
      '<svg viewBox="0 0 48 48" width="48" fill="none">' +
      '<path fill="currentColor" d="M4 40 L20 12 C30 12 36 20 36 40 Z"></path>' +
      '</svg>')
  })

  it('leaves an unterminated subpath open', () => {
    const { svg } = renderTaggedSvg(element('path', {
      d: { tag: 'Value', args: [{ tag: 'Paths', args: [[{
        start: [0, 0], endings: { tag: 'Open', args: [] },
        cmds: [{ tag: 'LineTo', args: [{ point: [10, 0] }] }],
      }]] }] },
    }))
    expect(svg).toContain('d="M0 0 L10 0"')
  })

  /** A tree we cannot fully read should cost one attribute, not the whole glyph. */
  it('drops what it does not understand and says so', () => {
    const { svg, warnings } = renderTaggedSvg(element('path', {
      d: { tag: 'Value', args: [{ tag: 'Paths', args: [[{
        start: [0, 0], cmds: [{ tag: 'WarpTo', args: [{ point: [5, 5] }] }],
      }]] }] },
      filter: { tag: 'Value', args: [{ tag: 'Blur', args: [{ radius: 2 }, {}] }] },
    }))
    expect(svg).toBe('<path d="M0 0"></path>')
    expect(warnings).toEqual([
      '<path d>: unknown path command "WarpTo"; dropped',
      '<path filter>: unknown attribute value "Blur"; dropped',
    ])
  })

  it('reads an unattested single-scalar wrapper rather than losing it', () => {
    const { svg, warnings } = renderTaggedSvg(element('path', {
      fill: { tag: 'Value', args: [{ tag: 'Paint', args: [{ tag: 'HslColor', args: ['hsl(0 0% 0%)'] }] }] },
    }))
    expect(svg).toBe('<path fill="hsl(0 0% 0%)"></path>')
    expect(warnings).toEqual([])
  })
})

describe('older icon-font projects', () => {
  it('is recognised, and is not mistaken for an IcoMoon file', () => {
    expect(isSvgNodeProject(project())).toBe(true)
    expect(isIcoMoonFile(project())).toBe(false)
    expect(isSvgNodeProject(fixture('icomoon/ossweather.json'))).toBe(false)
    expect(isSvgNodeProject({ glyphs: [{ extras: { name: 'a' } }] })).toBe(false)
    expect(isSvgNodeProject(null)).toBe(false)
  })

  it('imports every glyph, with artwork, in one set', () => {
    const { project: p, warnings } = importSvgNodeProject(project())
    const glyphs = p.sets.flatMap((s) => s.glyphs)

    expect(p.sets).toHaveLength(1)
    expect(glyphs).toHaveLength(55)
    expect(glyphs.every((g) => g.paths.length > 0)).toBe(true)
    expect(glyphs[0]!.name).toBe('altitude')
    expect(warnings).toEqual([])
  })

  it('keeps the codepoint each glyph already shipped with', () => {
    const { project: p } = importSvgNodeProject(project())
    // reassigning these would break every `` already written in an app
    expect(p.codepoints.altitude).toBe(0xf000)
    expect(p.codepoints.adminstrative_area).toBe(0xe900)
    expect(Object.keys(p.codepoints)).toHaveLength(55)
  })

  it('takes the font family from the project’s export format', () => {
    const { project: p } = importSvgNodeProject(project())
    expect(p.preferences.font.family).toBe('app')
    expect(p.sets[0]!.name).toBe('app')
  })

  it('scales artwork into the requested em box', () => {
    const { project: p } = importSvgNodeProject(project(), { targetHeight: 512 })
    expect(p.sets[0]!.height).toBe(512)
    const ys = p.sets[0]!.glyphs[0]!.paths.join(' ').match(/-?\d+(\.\d+)?/g)!.map(Number)
    expect(Math.max(...ys)).toBeLessThanOrEqual(512)
  })

  it('renames a glyph that would not be safe in CSS, and says so', () => {
    const file = project()
    file.glyphs = [{ ...file.glyphs[0], extras: { name: 'My Icon!', codePoint: 0xe900 } }]
    const { project: p, warnings } = importSvgNodeProject(file)
    expect(p.sets[0]!.glyphs[0]!.name).toBe('my-icon')
    expect(p.codepoints['my-icon']).toBe(0xe900)
    expect(warnings).toContain('glyph "My Icon!": renamed to "my-icon" so it is safe in CSS and ligatures')
  })

  it('refuses a file that is not one of these', () => {
    expect(() => importSvgNodeProject({ icons: [] })).toThrow(/expected `glyphs`/)
  })
})
