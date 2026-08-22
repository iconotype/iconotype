import { describe, expect, it } from 'vitest'
import { createMemoryHost } from '../src/index.js'

describe('memory host', () => {
  it('reads, writes and lists', async () => {
    const host = createMemoryHost({ '/p/icons.json': '{"a":1}' })
    expect(await host.fs.readText('/p/icons.json')).toBe('{"a":1}')
    await host.fs.write('/p/sets/walk.svg', '<svg/>')
    expect((await host.fs.list('/p')).map((e) => e.name).sort()).toEqual(['icons.json', 'sets'])
    expect(await host.fs.exists('/nope')).toBe(false)
  })

  it('every host answers assetBase — constraint 4', () => {
    expect(typeof createMemoryHost().assetBase()).toBe('string')
  })
})
