import { describe, expect, it } from 'vitest'
import { allocate, emptyProject, parseLock, PUA_START, serializeLock } from '../src/index.js'

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
