import { describe, expect, it, vi } from 'vitest'
import type { Host } from '@glyphsmith/core-host'
import { createHistory, emptyProject, type Glyph } from '@glyphsmith/core-model'
import { AppStore } from '../src/app.svelte.js'
import { SessionStore } from '../src/session.svelte.js'

const glyph = (name: string, over: Partial<Glyph> = {}): Glyph => ({
  id: name, name, aliases: [], tags: [name], paths: ['M0 0h512v512h-512z'], attrs: [{}],
  grid: 24, isMulticolor: false, ...over,
})

const fakeHost = () => {
  const writes: string[] = []
  const host = {
    name: 'test',
    assetBase: () => '',
    fs: {
      write: vi.fn(async (path: string) => { writes.push(path) }),
      readText: vi.fn(async () => { throw new Error('missing') }),
      remove: vi.fn(async () => {}),
    },
    clipboard: { writeText: vi.fn(async () => {}), readText: vi.fn(async () => '') },
    pickFiles: vi.fn(async () => []),
  } as unknown as Host
  return { host, writes }
}

const store = (project = emptyProject('p')) => {
  const { host, writes } = fakeHost()
  const session = new SessionStore({ project, history: createHistory() }, () => 0)
  return { app: new AppStore(session, host, () => 0), session, host, writes }
}

describe('AppStore persistence', () => {
  /**
   * Regression: in the VSCode editor the extension owns the file, but the shell's
   * autosave still wrote to the Host's own project store — `/projects/...` over the
   * webview RPC — which failed with "EROFS: read-only file system" on every edit.
   */
  it('does not write to the host store when the shell does not own persistence', async () => {
    const { app, writes } = store()
    app.autosave = false
    app.scheduleSave()
    await new Promise((r) => setTimeout(r, 700))
    expect(writes).toEqual([])
  })

  it('still autosaves when it does own persistence', async () => {
    const { app, writes } = store()
    app.scheduleSave()
    await new Promise((r) => setTimeout(r, 700))
    expect(writes.some((p) => p.startsWith('projects/'))).toBe(true)
  })
})

describe('AppStore glyph actions', () => {
  const multicolor = () => {
    const project = emptyProject('p')
    project.sets[0]!.glyphs = [glyph('road-cycling', {
      paths: ['M0 0h10v10h-10z', 'M20 0h10v10h-10z', 'M40 0h10v10h-10z'],
      attrs: [{ fill: '#e00' }, { fill: '#0e0' }, { fill: '#00e' }],
      isMulticolor: true,
    })]
    project.codepoints['road-cycling'] = [0xe916, 0xe917, 0xe918]
    return project
  }

  it('flattens a multicolor glyph to one shape and releases its extra codepoints', () => {
    const { app, session } = store(multicolor())
    app.flattenColors('road-cycling')

    const after = session.project.sets[0]!.glyphs[0]!
    expect(after.isMulticolor).toBe(false)
    // the artwork survives — the layers become subpaths of one shape
    expect(after.paths).toHaveLength(3)
    expect(after.attrs).toEqual([{}, {}, {}])
    // the FIRST codepoint is kept, so anything already built still renders
    expect(session.project.codepoints['road-cycling']).toBe(0xe916)
  })

  it('flattening is one undoable action', () => {
    const { app, session } = store(multicolor())
    app.flattenColors('road-cycling')
    session.undo()
    session.undo()
    expect(session.project.sets[0]!.glyphs[0]!.isMulticolor).toBe(true)
    expect(session.project.codepoints['road-cycling']).toEqual([0xe916, 0xe917, 0xe918])
  })

  it('replaces artwork while keeping the name, tags and codepoint', async () => {
    const project = emptyProject('p')
    project.sets[0]!.glyphs = [glyph('home', { tags: ['house', 'home'] })]
    project.codepoints['home'] = 0xe900

    const { app, session, host } = store(project)
    ;(host.pickFiles as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{
      name: 'new-home.svg',
      data: new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>'),
    }])

    await app.replaceArtwork('home')

    const after = session.project.sets[0]!.glyphs[0]!
    expect(after.name).toBe('home')
    expect(after.tags).toEqual(['house', 'home'])
    expect(session.project.codepoints['home']).toBe(0xe900)
    expect(after.paths[0]).not.toBe('M0 0h512v512h-512z')
  })
})
