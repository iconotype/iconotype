import { describe, expect, it } from 'vitest'
import {
  fetchIconRefs,
  fetchIcons,
  listCollection,
  listCollections,
  parseIconRef,
  searchIcons,
  setMetadataFor,
  toGlyphs,
  uniqueName,
  type CollectionInfo,
} from '../src/iconify.js'

/**
 * A stand-in for the API, recording what was asked for.
 *
 * The shapes are copied from real responses (`api.iconify.design`, checked against
 * lucide/mdi/material-symbols), so a change to the client that stops matching the
 * service fails here rather than in a picker that quietly shows nothing.
 */
function stubApi(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fetch = (async (url: string) => {
    calls.push(String(url))
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '')
    const key = Object.keys(routes).find((k) => path.startsWith(k))
    if (!key) return { ok: false, status: 404, statusText: 'Not Found' }
    return { ok: true, status: 200, json: async () => routes[key] }
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

const LUCIDE: CollectionInfo = {
  prefix: 'lucide',
  name: 'Lucide',
  total: 1776,
  author: { name: 'Lucide Contributors', url: 'https://github.com/lucide-icons/lucide' },
  license: { title: 'ISC', spdx: 'ISC', url: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE' },
}

// a filled square, so the fixer has geometry it cannot reduce to nothing
const SQUARE = '<path d="M4 4h16v16H4z"/>'

describe('icon refs', () => {
  it('parses prefix:name and rejects the malformed', () => {
    expect(parseIconRef('lucide:house')).toEqual({ prefix: 'lucide', name: 'house' })
    // some names contain a dash and a digit; only the FIRST colon separates
    expect(parseIconRef('material-symbols:home-2')).toEqual({ prefix: 'material-symbols', name: 'home-2' })
    expect(parseIconRef('house')).toBeNull()
    expect(parseIconRef(':house')).toBeNull()
    expect(parseIconRef('lucide:')).toBeNull()
  })
})

describe('search', () => {
  it('returns refs and the collections they came from', async () => {
    const { fetch, calls } = stubApi({
      '/search': {
        icons: ['lucide:house', 'mdi:home'],
        total: 42,
        collections: { lucide: { name: 'Lucide', total: 1776, license: { title: 'ISC' } } },
      },
    })
    const result = await searchIcons('home', { fetch, limit: 96, prefixes: ['lucide', 'mdi'] })
    expect(result.icons).toEqual([
      { prefix: 'lucide', name: 'house' },
      { prefix: 'mdi', name: 'home' },
    ])
    expect(result.total).toBe(42)
    // the prefix is folded back in, so a caller holding one collection knows which
    expect(result.collections.lucide?.prefix).toBe('lucide')
    expect(calls[0]).toContain('limit=96')
    expect(calls[0]).toContain('prefixes=lucide%2Cmdi')
  })

  it('does not call the API for an empty query', async () => {
    const { fetch, calls } = stubApi({})
    expect(await searchIcons('   ', { fetch })).toEqual({ icons: [], total: 0, collections: {} })
    expect(calls).toEqual([])
  })

  it('reports a failed request rather than returning nothing', async () => {
    const { fetch } = stubApi({})
    await expect(searchIcons('home', { fetch })).rejects.toThrow(/404/)
  })

  it('honours a self-hosted API root', async () => {
    const { fetch, calls } = stubApi({ '/search': { icons: [] } })
    await searchIcons('home', { fetch, host: 'https://icons.internal/api/' })
    // the trailing slash is trimmed, or the path doubles up
    expect(calls[0]).toBe('https://icons.internal/api/search?query=home')
  })
})

describe('collections', () => {
  it('lists them with their prefix', async () => {
    const { fetch } = stubApi({ '/collections': { lucide: { name: 'Lucide', total: 1776 } } })
    const all = await listCollections({ fetch })
    expect(all.lucide).toMatchObject({ prefix: 'lucide', name: 'Lucide', total: 1776 })
  })

  it('flattens one collection and drops hidden icons', async () => {
    const { fetch } = stubApi({
      '/collection': {
        prefix: 'lucide',
        title: 'Lucide',
        total: 3,
        uncategorized: ['house'],
        categories: { Arrows: ['arrow-up', 'arrow-down'] },
        hidden: ['arrow-down'],
      },
    })
    const listing = await listCollection('lucide', { fetch })
    expect(listing.icons).toEqual(['house', 'arrow-up'])
    expect(listing.categories.Arrows).toEqual(['arrow-up', 'arrow-down'])
  })
})

describe('fetching artwork', () => {
  it('rebuilds a real viewBox, which the .svg endpoint does not give', async () => {
    const { fetch } = stubApi({ '/lucide.json': { prefix: 'lucide', width: 24, height: 24, icons: { house: { body: SQUARE } } } })
    const [icon] = await fetchIcons('lucide', ['house'], { fetch })
    expect(icon!.svg).toContain('viewBox="0 0 24 24"')
    expect(icon!.svg).toContain('width="24"')
    expect(icon!.size).toBe(24)
  })

  it('falls back to Iconify’s 16×16 default when the set does not say', async () => {
    const { fetch } = stubApi({ '/x.json': { prefix: 'x', icons: { a: { body: SQUARE } } } })
    const [icon] = await fetchIcons('x', ['a'], { fetch })
    expect(icon!.svg).toContain('viewBox="0 0 16 16"')
  })

  it('resolves an alias to its parent and keeps the rotation', async () => {
    const { fetch } = stubApi({
      '/lucide.json': {
        prefix: 'lucide',
        width: 24,
        height: 24,
        icons: { 'arrow-right': { body: SQUARE } },
        aliases: { 'arrow-up': { parent: 'arrow-right', rotate: 3 } },
      },
    })
    const [icon] = await fetchIcons('lucide', ['arrow-up'], { fetch })
    // dropped, the alias would point the wrong way; the pipeline bakes the transform
    expect(icon!.svg).toContain('rotate(270 12 12)')
    expect(icon!.svg).toContain(SQUARE)
  })

  it('skips names the API does not know instead of failing the batch', async () => {
    const { fetch } = stubApi({
      '/lucide.json': { prefix: 'lucide', width: 24, height: 24, icons: { house: { body: SQUARE } }, not_found: ['nope'] },
    })
    const icons = await fetchIcons('lucide', ['house', 'nope'], { fetch })
    expect(icons.map((i) => i.name)).toEqual(['house'])
  })

  it('chunks long name lists so no URL grows unbounded', async () => {
    const { fetch, calls } = stubApi({ '/lucide.json': { prefix: 'lucide', width: 24, height: 24, icons: {} } })
    await fetchIcons('lucide', Array.from({ length: 150 }, (_, i) => `icon-${i}`), { fetch })
    expect(calls).toHaveLength(3)
    for (const call of calls) expect(call.length).toBeLessThan(2048)
  })

  it('groups mixed refs into one request per collection and keeps the caller’s order', async () => {
    const { fetch, calls } = stubApi({
      '/lucide.json': { prefix: 'lucide', width: 24, height: 24, icons: { house: { body: SQUARE } } },
      '/mdi.json': { prefix: 'mdi', width: 24, height: 24, icons: { home: { body: SQUARE } } },
    })
    const refs = [
      { prefix: 'mdi', name: 'home' },
      { prefix: 'lucide', name: 'house' },
      { prefix: 'mdi', name: 'gone' },
    ]
    const icons = await fetchIconRefs(refs, { fetch })
    expect(calls).toHaveLength(2)
    expect(icons.map((i) => `${i.prefix}:${i.name}`)).toEqual(['mdi:home', 'lucide:house'])
  })
})

describe('to glyphs', () => {
  const icons = [{ prefix: 'lucide', name: 'house', size: 24, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${SQUARE}</svg>` }]

  it('attaches the collection’s licence and a link back to the source', () => {
    const [result] = toGlyphs(icons, { lucide: LUCIDE }, { targetHeight: 1024 })
    expect(result!.glyph.source).toEqual({
      url: 'https://icon-sets.iconify.design/lucide/house/',
      license: 'ISC',
      author: 'Lucide Contributors',
      importedFrom: 'lucide:house',
    })
    expect(result!.glyph.paths).toHaveLength(1)
    expect(result!.glyph.grid).toBe(24)
  })

  it('renames around a name the project already uses', () => {
    // two libraries both call it `home`; without this the second wins in the stylesheet
    const [result] = toGlyphs(icons, { lucide: LUCIDE }, { taken: ['house'] })
    expect(result!.glyph.name).toBe('house-2')
  })

  it('shares one `taken` set across collections when given a Set', () => {
    // copied instead of shared, Tabler's `arrow-up` never saw Lucide's: both kept the
    // name, and `allocate` then put both on the same codepoint
    const taken = new Set<string>()
    const lucide = [{ prefix: 'lucide', name: 'house', size: 24, svg: icons[0]!.svg }]
    const tabler = [{ prefix: 'tabler', name: 'house', size: 24, svg: icons[0]!.svg }]
    const a = toGlyphs(lucide, {}, { taken })
    const b = toGlyphs(tabler, {}, { taken })
    expect([a[0]!.glyph.name, b[0]!.glyph.name]).toEqual(['house', 'house-2'])
  })

  it('gives a re-added icon its own id, not the one already in the project', () => {
    // a duplicate id made `glyph.add` treat the second as the same glyph, so "Add 3"
    // silently added one
    const taken = new Set(['house'])
    const [again] = toGlyphs(icons, {}, { taken })
    expect(again!.glyph.name).toBe('house-2')
    expect(again!.glyph.id).toBe('iconify:lucide:house-2')
  })

  it('can qualify names with the collection', () => {
    const [result] = toGlyphs(icons, { lucide: LUCIDE }, { qualifyNames: true })
    expect(result!.glyph.name).toBe('lucide-house')
  })

  it('drops artwork the pipeline refuses rather than throwing the batch away', () => {
    const broken = [{ prefix: 'x', name: 'bad', size: 16, svg: 'not svg at all' }]
    expect(toGlyphs([...broken, ...icons], { lucide: LUCIDE })).toHaveLength(1)
  })
})

describe('attribution', () => {
  it('carries the licence onto the set, where the font build reads it', () => {
    expect(setMetadataFor(LUCIDE)).toEqual({
      url: 'https://github.com/lucide-icons/lucide',
      designer: 'Lucide Contributors',
      designerURL: 'https://github.com/lucide-icons/lucide',
      license: 'ISC',
      licenseURL: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE',
    })
  })

  it('counts up past an existing suffix', () => {
    expect(uniqueName('home', new Set(['home', 'home-2']))).toBe('home-3')
    expect(uniqueName('home', new Set())).toBe('home')
  })
})
