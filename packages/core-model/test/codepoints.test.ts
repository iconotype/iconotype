import { describe, expect, it } from 'vitest'
import { allocate, emptyProject, fitCodepoints, parseLock, PUA_START, serializeLock } from '../src/index.js'

describe('codepoint allocator', () => {
  it('allocates from 0xE900 like IcoMoon', () => {
    const p = emptyProject('p')
    const { assignments } = allocate(p, [{ name: 'a' }, { name: 'b' }])
    expect(assignments).toEqual({ a: PUA_START, b: PUA_START + 1 })
  })

  it('reserves a contiguous run for multicolor layers', () => {
    const p = emptyProject('p')
    const { assignments } = allocate(p, [{ name: 'flag', layers: 3 }, { name: 'next' }])
    expect(assignments.flag).toEqual([0xe900, 0xe901, 0xe902])
    expect(assignments.next).toBe(0xe903)
  })

  // Codepoints are an API: a stale CSS build must never render a different glyph.
  it('never reassigns an existing name and never reuses a freed slot', () => {
    const p = emptyProject('p')
    p.codepoints = { old: 0xe900, kept: 0xe905 }
    const { assignments } = allocate(p, [{ name: 'kept' }, { name: 'fresh' }])
    expect(assignments.kept).toBeUndefined()      // already stable, left alone
    expect(assignments.fresh).toBe(0xe906)        // continues past the highest, no gap reuse
  })

  it('reclaims gaps only when explicitly asked', () => {
    const p = emptyProject('p')
    p.codepoints = { high: 0xe905 }
    const { assignments } = allocate(p, [{ name: 'fresh' }], { reclaim: true })
    expect(assignments.fresh).toBe(0xe900)
  })

  it('round-trips the lockfile', () => {
    const p = emptyProject('p')
    p.codepoints = { altitude: 0xe900, flag: [0xe901, 0xe902, 0xe903] }
    const text = serializeLock(p)
    expect(text).toContain('altitude\tU+e900')
    expect(text).toContain('flag\tU+e901..U+e903')
    expect(parseLock(text)).toEqual(p.codepoints)
  })
})

describe('fitCodepoints', () => {
  const project = () => {
    const p = emptyProject('p')
    p.codepoints = { home: 0xe900, flag: [0xe901, 0xe902, 0xe903] }
    return p
  }

  it('gives a glyph that gained a colour layer a codepoint for it, keeping its own', () => {
    expect(fitCodepoints(project(), 'home', 2)).toEqual([0xe900, 0xe904])
  })

  it('releases surplus codepoints from the end', () => {
    expect(fitCodepoints(project(), 'flag', 2)).toEqual([0xe901, 0xe902])
    expect(fitCodepoints(project(), 'flag', 1)).toBe(0xe901)
  })

  it('leaves a glyph that already fits, or has nothing yet, alone', () => {
    expect(fitCodepoints(project(), 'home', 1)).toBeUndefined()
    expect(fitCodepoints(project(), 'new', 3)).toBeUndefined()
  })
})

describe('codepoints.lock', () => {
  it('round-trips a layer run with a gap in it', () => {
    const p = emptyProject('p')
    p.codepoints = { flag: [0xe900, 0xe902], run: [0xe903, 0xe904, 0xe905] }
    expect(parseLock(serializeLock(p))).toEqual(p.codepoints)
  })
})
