import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { Host } from '@iconotype/core-host'
import { createHistory, emptyProject, type Glyph } from '@iconotype/core-model'
import { serializeIconFont } from '@iconotype/core-io'
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

describe('AppStore import', () => {
  const file = (name: string, text: string) => ({ name, data: new TextEncoder().encode(text) })
  const fixture = (name: string) =>
    readFileSync(fileURLToPath(new URL(`../../../fixtures/icomoon/${name}`, import.meta.url)), 'utf8')

  /**
   * Regression: the importer took IcoMoon's formats and refused our own, so a file
   * this app had just written could not be opened by it.
   */
  it('opens an Iconotype project file', async () => {
    const { app, session } = store()

    const source = emptyProject('src', 'app')
    source.preferences.font.family = 'app'
    source.sets[0]!.glyphs = [glyph('home'), glyph('user')]
    source.codepoints = { home: 0xe900, user: 0xe901 }

    await app.importFiles([file('app.iconotype.json', serializeIconFont(source))])

    expect(session.project.sets.flatMap((s) => s.glyphs).map((g) => g.name)).toEqual(['home', 'user'])
    expect(session.project.codepoints['user']).toBe(0xe901)
    expect(app.notices.some((n) => n.kind === 'error')).toBe(false)
  })

  it('imports a current IcoMoon project', async () => {
    const { app, session } = store()
    await app.importFiles([file('alpimaps.json', fixture('alpimaps.json'))])
    expect(session.project.sets.flatMap((s) => s.glyphs)).toHaveLength(25)
  })

  /** An export from an older IcoMoon: no ligatures, `tempChar`, per-glyph `width`. */
  it('imports an older IcoMoon project', async () => {
    const { app, session } = store()
    await app.importFiles([file('ossweather.json', fixture('ossweather.json'))])

    const glyphs = session.project.sets.flatMap((s) => s.glyphs)
    expect(glyphs).toHaveLength(10)
    expect(session.project.codepoints['wind_0']).toBe(59648)
    expect(glyphs.find((g) => g.name === 'wind_0')!.advanceWidth).toBe(1034)
    expect(session.project.preferences.font.family).toBe('ossweather')
  })

  it('says what it accepts when handed something else', async () => {
    const { app } = store()
    await app.importFiles([file('random.json', '{"hello":"world"}')])
    expect(app.notices.at(-1)!.text).toMatch(/not an Iconotype project, or an IcoMoon/)
  })
})

describe('AppStore glyph editor', () => {
  const editing = () => {
    const project = emptyProject('p')
    project.sets[0]!.height = 1024
    project.sets[0]!.glyphs = [
      glyph('first', { paths: ['M100 100H300V300H100Z'] }),
      glyph('second'),
      glyph('third'),
    ]
    const s = store(project)
    s.app.edit('first')
    return s
  }

  it('steps through the icons and wraps at both ends', () => {
    const { app } = editing()
    expect(app.editingIndex).toEqual({ index: 1, total: 3 })

    app.step(1)
    expect(app.editingGlyph!.glyph.name).toBe('second')

    app.step(-1)
    app.step(-1)
    // wrapping is the point: editing a set is a run, not a dead end at the last one
    expect(app.editingGlyph!.glyph.name).toBe('third')

    app.step(1)
    expect(app.editingGlyph!.glyph.name).toBe('first')
  })

  it('moves the artwork and records it as one labelled step', async () => {
    const { app, session } = editing()
    await app.nudge(16, -8)

    expect(session.project.sets[0]!.glyphs[0]!.paths[0]).not.toBe('M100 100H300V300H100Z')
    expect(session.timeline.at(-1)!.label).toBe('Move first')

    session.undo()
    expect(session.project.sets[0]!.glyphs[0]!.paths[0]).toBe('M100 100H300V300H100Z')
  })

  it('aligns to the em box using the set height', async () => {
    const { app, session } = editing()
    await app.align('right')

    const { boundsOf } = await import('@iconotype/core-svg')
    const bounds = boundsOf(session.project.sets[0]!.glyphs[0]!.paths)!
    expect(Math.round(bounds.x + bounds.width)).toBe(1024)
  })

  it('outlines strokes into fills, and says so when there are none', async () => {
    const project = emptyProject('p')
    project.sets[0]!.glyphs = [glyph('line', {
      paths: ['M100 512H900'],
      attrs: [{ stroke: '#000', 'stroke-width': '40', fill: 'none' }],
    })]
    const { app, session } = store(project)
    app.edit('line')

    await app.strokeToFill()
    const after = session.project.sets[0]!.glyphs[0]!
    // an open line has no area; the outlined version is a closed 40-unit bar
    expect(after.paths[0]).toMatch(/z/i)
    expect(after.attrs[0]!.stroke).toBeUndefined()

    await app.strokeToFill()
    expect(app.notices.at(-1)!.text).toMatch(/already filled/)
  })

  it('merges overlapping shapes into one', async () => {
    const project = emptyProject('p')
    project.sets[0]!.glyphs = [glyph('two', {
      paths: ['M0 0H200V200H0Z', 'M100 100H300V300H100Z'],
      attrs: [{}, {}],
    })]
    const { app, session } = store(project)
    app.edit('two')

    await app.mergeOverlaps()
    expect(session.project.sets[0]!.glyphs[0]!.paths).toHaveLength(1)
    expect(session.timeline.at(-1)!.label).toBe('Merge overlaps in two')
  })

  it('does nothing when a transform would not change the artwork', async () => {
    const { app, session } = editing()
    const steps = session.timeline.length
    await app.nudge(0, 0)
    // an empty history entry is worse than no entry: undo would appear to do nothing
    expect(session.timeline.length).toBe(steps)
  })
})
