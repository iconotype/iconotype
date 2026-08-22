import { describe, expect, it } from 'vitest'
import {
  alignOffset, alignPaths, boundsOf, fitToBox, flipPaths, mergeOverlaps,
  rotatePaths, scalePaths, snapPaths, translatePaths,
} from '../src/index.js'

const square = (x = 100, y = 100, w = 200, h = 200) =>
  [`M${x} ${y}H${x + w}V${y + h}H${x}Z`]

const round = (n: number) => Math.round(n * 100) / 100
const box = (paths: string[]) => {
  const b = boundsOf(paths)!
  return { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) }
}

describe('glyph transforms', () => {
  it('moves every subpath together', () => {
    const two = [...square(0, 0, 100, 100), ...square(500, 500, 100, 100)]
    const moved = translatePaths(two, 20, -10)
    expect(box(moved)).toEqual({ x: 20, y: -10, width: 600, height: 600 })
  })

  it('scales about the artwork centre, not the origin', () => {
    const before = box(square(100, 100, 200, 200))
    const after = box(scalePaths(square(100, 100, 200, 200), 0.5))
    // the centre stays put; only the size changes
    expect(round(after.x + after.width / 2)).toBe(round(before.x + before.width / 2))
    expect(round(after.y + after.height / 2)).toBe(round(before.y + before.height / 2))
    expect(after.width).toBe(100)
  })

  it('flips in place', () => {
    const paths = ['M100 100H300V150H200V300H100Z']
    const flipped = flipPaths(paths, 'horizontal')
    expect(box(flipped)).toEqual(box(paths))
    // twice is the identity, geometrically
    expect(box(flipPaths(flipped, 'horizontal'))).toEqual(box(paths))
  })

  it('rotates a quarter turn about the centre', () => {
    const paths = square(100, 200, 400, 200)
    const turned = box(rotatePaths(paths, 90))
    expect(turned.width).toBe(200)
    expect(turned.height).toBe(400)
    expect(round(turned.x + turned.width / 2)).toBe(300)
  })

  it('aligns to every edge of the em box', () => {
    const paths = square(100, 100, 200, 200)
    expect(box(alignPaths(paths, 1024, 'left')).x).toBe(0)
    expect(box(alignPaths(paths, 1024, 'right')).x).toBe(824)
    expect(box(alignPaths(paths, 1024, 'top')).y).toBe(0)
    expect(box(alignPaths(paths, 1024, 'bottom')).y).toBe(824)

    const centred = box(alignPaths(paths, 1024, 'center'))
    expect(centred.x).toBe(412)
    expect(centred.y).toBe(412)
  })

  it('computes the offset without touching the artwork', () => {
    expect(alignOffset({ x: 100, y: 100, width: 200, height: 200 }, 1024, 'right'))
      .toEqual({ dx: 724, dy: 0 })
  })

  it('fits to the box with padding, keeping the aspect ratio', () => {
    const wide = square(0, 0, 400, 100)
    const fitted = box(fitToBox(wide, 1000, 50))
    expect(fitted.width).toBe(900)
    expect(fitted.height).toBe(225)
    // centred in what is left
    expect(round(fitted.y + fitted.height / 2)).toBe(500)
  })

  /**
   * Two overlapping squares are two contours. A non-zero fill hides that, but an
   * even-odd rasterizer punches the intersection out as a hole.
   */
  it('merges overlapping shapes into one outline', () => {
    const overlapping = [...square(0, 0, 200, 200), ...square(100, 100, 200, 200)]
    const merged = mergeOverlaps(overlapping)
    expect(merged).toHaveLength(1)
    expect(box(merged)).toEqual({ x: 0, y: 0, width: 300, height: 300 })
  })

  it('leaves a single shape alone', () => {
    const one = square()
    expect(mergeOverlaps(one)).toBe(one)
  })

  it('snaps coordinates onto a grid', () => {
    const off = ['M13 27H197V203H13Z']
    const snapped = snapPaths(off, 16, 1024)  // 64-unit steps
    const b = box(snapped)
    for (const value of [b.x, b.y, b.width, b.height]) expect(value % 64).toBe(0)
  })
})
