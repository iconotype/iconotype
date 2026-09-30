import { describe, expect, it } from 'vitest'
import { splitShapes } from '../src/index.js'

describe('splitShapes', () => {
  it('splits side-by-side shapes', () => {
    const shapes = splitShapes('M0 0H10V10H0Z M20 0H30V10H20Z')
    expect(shapes).toHaveLength(2)
    expect(shapes[1]!.bounds).toEqual({ x: 20, y: 0, width: 10, height: 10 })
  })

  it('keeps a hole with the outline it is cut into', () => {
    // a ring: outer square, inner square wound the other way
    const shapes = splitShapes('M0 0H100V100H0Z M25 25V75H75V25Z')
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.subpaths).toBe(2)
  })

  it('treats an island inside a hole as a shape of its own', () => {
    const shapes = splitShapes('M0 0H100V100H0Z M20 20V80H80V20Z M40 40H60V60H40Z')
    expect(shapes.map((s) => s.subpaths)).toEqual([2, 1])
  })

  it('does not rely on winding: same-direction hole still nests', () => {
    const shapes = splitShapes('M0 0H100V100H0Z M25 25H75V75H25Z')
    expect(shapes).toHaveLength(1)
  })

  it('resolves relative commands so each shape stands alone', () => {
    const shapes = splitShapes('m10 10h10v10h-10z m20 0h10v10h-10z')
    expect(shapes).toHaveLength(2)
    // the second `m` is relative to where the first subpath closed, (10,10)
    expect(shapes[1]!.d).toBe('M30 10 H40 V20 H30 Z')
    expect(shapes[1]!.bounds.x).toBe(30)
  })

  it('reads curves and packed arc flags', () => {
    const shapes = splitShapes('M0 50C0 0 100 0 100 50S0 100 0 50Z M200 50a10 10 0 1110 10z')
    expect(shapes).toHaveLength(2)
    expect(shapes[1]!.d).toMatch(/^M200 50 A10 10 0 1 1 210 60 Z$/)
  })

  it('has nothing for empty geometry', () => {
    expect(splitShapes('')).toEqual([])
  })
})
