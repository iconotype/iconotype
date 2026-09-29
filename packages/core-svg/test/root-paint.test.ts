import { describe, expect, it } from 'vitest'
import { fixSvg } from '../src/index.js'

/**
 * Line-icon sets (Lucide, Feather, Tabler) declare their paint once, on the root:
 * `<svg fill="none" stroke="…">`. Ignoring the root's attributes made every child
 * a black fill with no stroke, and a `<line>` has no area — so the icon imported empty.
 */
describe('paint declared on the root <svg>', () => {
  const lines = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#262019" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><line x1='5' y1='20' x2='5' y2='14'/><line x1='12' y1='20' x2='12' y2='9'/><line x1='19' y1='20' x2='19' y2='4'/></svg>`

  it('outlines a root-level stroke', () => {
    const result = fixSvg(lines, { targetHeight: 1024 })
    expect(result.findings.map((f) => f.code)).not.toContain('EMPTY')
    expect(result.findings.map((f) => f.code)).toContain('STROKE_OUTLINED')
    expect(result.stats.contours).toBe(3)
  })

  it('honours a root fill="none" rather than filling the shape', () => {
    const box = '<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2"><rect x="4" y="4" width="16" height="16"/></svg>'
    const result = fixSvg(box, { targetHeight: 24 })
    // an outlined square is a ring: two contours, not one solid block
    expect(result.stats.contours).toBe(2)
  })

  it('lets a child override the root', () => {
    const svg = '<svg viewBox="0 0 24 24" fill="none" stroke="black"><path fill="black" stroke="none" d="M4 4h16v16H4z"/></svg>'
    const result = fixSvg(svg, { targetHeight: 24 })
    expect(result.findings.map((f) => f.code)).not.toContain('STROKE_OUTLINED')
    expect(result.stats.contours).toBe(1)
  })
})
