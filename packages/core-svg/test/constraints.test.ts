import { describe, expect, it } from 'vitest'
import { PaperOffset } from 'paperjs-offset'
import paper from 'paper'
import { bakePath, getPaper, outlineStroke, shapeToPath } from '../src/index.js'

/**
 * Regression tests for the two traps spike 01 found. These are not academic:
 * either one silently ruins every outlined icon, and both are one import away.
 */
describe('constraint 1 — single paper instance', () => {
  it('paperjs-offset accepts paths built from our paper module', () => {
    const p = getPaper()
    const path = new p.Path('M0 500 L1000 500')
    // throws "Offset source must be a Paper.js Path" if the alias is missing
    const out = PaperOffset.offsetStroke(path, 10, { cap: 'butt', insert: false })
    expect(Math.abs(out.area)).toBeCloseTo(20000, 0)
  })

  it('the module we import IS the module paperjs-offset imports', () => {
    expect(getPaper()).toBe(paper)
  })
})

describe('constraint 2 — offsetStroke(p, d) yields width 2d', () => {
  it('outlineStroke takes a real SVG stroke-width', () => {
    // 1000-long line, stroke-width 20 → area 20000, not 40000
    const d = outlineStroke('M0 500 L1000 500', 20, { cap: 'butt' })
    const p = getPaper()
    const item = new p.CompoundPath(d)
    expect(Math.abs(item.area)).toBeCloseTo(20000, 0)
    expect(item.bounds.height).toBeCloseTo(20, 1)
  })

  it('outlining a closed shape produces a ring', () => {
    const square = 'M100 100H500V500H100Z'
    const d = outlineStroke(square, 20, { join: 'miter' })
    const item = new (getPaper().CompoundPath)(d)
    expect(item.children.length).toBe(2)               // outer + inner contour
    expect(item.bounds.width).toBeCloseTo(420, 1)      // 400 + 2 × half-width
  })
})

describe('shape conversion', () => {
  it('converts the primitives', () => {
    expect(shapeToPath('rect', { x: '0', y: '0', width: '10', height: '10' })).toBe('M0 0H10V10H0Z')
    expect(shapeToPath('line', { x1: '0', y1: '0', x2: '5', y2: '5' })).toBe('M0 0L5 5')
    expect(shapeToPath('polygon', { points: '0,0 10,0 10,10' })).toBe('M0 0L10 0L10 10Z')
    expect(shapeToPath('polyline', { points: '0,0 10,0' })).toBe('M0 0L10 0')
    expect(shapeToPath('circle', { cx: '5', cy: '5', r: '5' })).toContain('A5 5')
    expect(shapeToPath('rect', { width: '10', height: '10', rx: '2' })).toContain('A2 2')
    expect(shapeToPath('text', {})).toBeNull()
  })

  it('bakes transforms and removes arcs and shorthand', () => {
    const out = bakePath('M0 0 A5 5 0 0 1 10 10', [2, 0, 0, 2, 0, 0])
    expect(out).not.toMatch(/[Aa]/)
    expect(out).toMatch(/^M0 0/)
  })

  it('rescales from a source height to the set height', () => {
    const out = bakePath('M0 0H24', undefined, { sourceHeight: 24, targetHeight: 1024 })
    expect(out).toContain('1024')
  })
})
