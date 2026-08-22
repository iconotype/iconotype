import { describe, expect, it } from 'vitest'
import { createMemoryHost } from '@iconotype/core-host'
import { folderOf, forgetRecent, listRecents, recordRecent } from '../src/recents.js'

describe('recent projects', () => {
  it('puts the last opened first, without duplicating it', async () => {
    const host = createMemoryHost()
    await recordRecent(host, { path: '/a/app.iconotype.json', name: 'app', openedAt: 1 })
    await recordRecent(host, { path: '/b/admin.iconotype.json', name: 'admin', openedAt: 2 })
    await recordRecent(host, { path: '/a/app.iconotype.json', name: 'app', openedAt: 3 })

    const recents = await listRecents(host)
    expect(recents.map((r) => r.name)).toEqual(['app', 'admin'])
    expect(recents[0]!.openedAt).toBe(3)
  })

  it('keeps the list short', async () => {
    const host = createMemoryHost()
    for (let i = 0; i < 20; i++) {
      await recordRecent(host, { path: `/p/${i}.iconotype.json`, name: `p${i}`, openedAt: i })
    }
    expect(await listRecents(host)).toHaveLength(12)
  })

  it('forgets one', async () => {
    const host = createMemoryHost()
    await recordRecent(host, { path: '/a/app.iconotype.json', name: 'app', openedAt: 1 })
    await recordRecent(host, { id: 'p0', name: 'browser one', openedAt: 2 })

    expect(await forgetRecent(host, { path: '/a/app.iconotype.json', name: 'app', openedAt: 1 }))
      .toEqual([{ id: 'p0', name: 'browser one', openedAt: 2 }])
  })

  it('survives a missing or corrupt store', async () => {
    expect(await listRecents(createMemoryHost())).toEqual([])
    expect(await listRecents(createMemoryHost({ 'recent.json': 'not json' }))).toEqual([])
    expect(await listRecents(createMemoryHost({ 'recent.json': '{"not":"an array"}' }))).toEqual([])
  })

  it('shows the folder, shortened to ~ where it can be', () => {
    const entry = { path: '/Users/me/code/app/app.iconotype.json', name: 'app', openedAt: 0 }
    expect(folderOf(entry, '/Users/me')).toBe('~/code/app')
    expect(folderOf(entry)).toBe('/Users/me/code/app')
    // two projects called `icons` are told apart by where they live, not by their name
    expect(folderOf({ id: 'p0', name: 'icons', openedAt: 0 })).toBe('browser storage')
  })
})
